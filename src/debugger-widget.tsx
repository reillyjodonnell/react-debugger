import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';

export interface DebuggerState {
  isOpen: boolean;
  isPaused: boolean;
  isAddingBreakpoints: boolean;
  sections: {
    logs: boolean;
    breakpoints: boolean;
    components: boolean;
  };
  logs: Array<{
    type: 'info' | 'warn' | 'error';
    message: string;
    timestamp: number;
  }>;
  breakpoints: Array<{
    id: string;
    component: string;
    line: number;
    condition?: string;
    enabled: boolean;
    breakpointId?: string;
  }>;
  currentBreakpoint?: {
    id: string;
    component: string;
    line: number;
    timestamp: number;
  };
  selectedBreakpoint?: string;
  capturedData?: {
    props: Record<string, any>;
    state: Record<string, any>;
    context: Record<string, any>;
    hooks: Array<{
      type: string;
      value: any;
      index: number;
    }>;
    renderCount: number;
    lastRenderTime: number;
  };
}

interface ComponentInfo {
  name: string;
  sourceLocation: {
    file: string;
    line: number;
    column: number;
  };
  boundingRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

const DebuggerOverlayComponent: React.FC<{
  state: DebuggerState;
  onStateChange: (newState: DebuggerState) => void;
  cdpSocket: WebSocket | null;
  isConnected: boolean;
  sendCDPCommand: (method: string, params?: any) => Promise<any>;
}> = ({ state, onStateChange, cdpSocket, isConnected, sendCDPCommand }) => {
  const toggleSection = (section: keyof typeof state.sections) => {
    onStateChange({
      ...state,
      sections: {
        ...state.sections,
        [section]: !state.sections[section],
      },
    });
  };

  const toggleBreakpointMode = () => {
    const newMode = !state.isAddingBreakpoints;
    onStateChange({
      ...state,
      isAddingBreakpoints: newMode,
      logs: [
        ...state.logs,
        {
          type: 'info',
          message: `Breakpoint mode ${
            newMode
              ? 'enabled - click components to add breakpoints'
              : 'disabled'
          }`,
          timestamp: Date.now(),
        },
      ],
    });

    // Send message to parent to update highlighting
    window.parent.postMessage(
      {
        type: 'toggleHighlighting',
        payload: { enabled: newMode },
      },
      '*'
    );
  };

  const clearLogs = () => {
    onStateChange({ ...state, logs: [] });
  };

  const clearBreakpoints = () => {
    onStateChange({ ...state, breakpoints: [] });

    // Send updated breakpoints to overlay
    window.parent.postMessage(
      {
        type: 'updateBreakpoints',
        payload: { breakpoints: [] },
      },
      '*'
    );
  };

  const toggleBreakpoint = (breakpointId: string) => {
    onStateChange({
      ...state,
      breakpoints: state.breakpoints.map((bp) =>
        bp.id === breakpointId ? { ...bp, enabled: !bp.enabled } : bp
      ),
    });

    // Send updated breakpoints to overlay
    const updatedBreakpoints = state.breakpoints.map((bp) =>
      bp.id === breakpointId ? { ...bp, enabled: !bp.enabled } : bp
    );
    window.parent.postMessage(
      {
        type: 'updateBreakpoints',
        payload: { breakpoints: updatedBreakpoints },
      },
      '*'
    );
  };

  const removeBreakpoint = (breakpointId: string) => {
    onStateChange({
      ...state,
      breakpoints: state.breakpoints.filter((bp) => bp.id !== breakpointId),
      selectedBreakpoint:
        state.selectedBreakpoint === breakpointId
          ? undefined
          : state.selectedBreakpoint,
    });
  };

  const selectBreakpoint = (breakpointId: string) => {
    onStateChange({
      ...state,
      selectedBreakpoint:
        state.selectedBreakpoint === breakpointId ? undefined : breakpointId,
    });
  };

  const resumeExecution = async () => {
    try {
      await sendCDPCommand('Debugger.resume');
      onStateChange({
        ...state,
        isPaused: false,
        currentBreakpoint: undefined,
        selectedBreakpoint: undefined,
        capturedData: undefined,
        logs: [
          ...state.logs,
          {
            type: 'info',
            message: 'Execution resumed',
            timestamp: Date.now(),
          },
        ],
      });
    } catch (error) {
      onStateChange({
        ...state,
        logs: [
          ...state.logs,
          {
            type: 'error',
            message: `Failed to resume: ${error}`,
            timestamp: Date.now(),
          },
        ],
      });
    }
  };

  const stepOver = async () => {
    try {
      await sendCDPCommand('Debugger.stepOver');
      onStateChange({
        ...state,
        logs: [
          ...state.logs,
          {
            type: 'info',
            message: 'Step over executed',
            timestamp: Date.now(),
          },
        ],
      });
    } catch (error) {
      onStateChange({
        ...state,
        logs: [
          ...state.logs,
          {
            type: 'error',
            message: `Failed to step over: ${error}`,
            timestamp: Date.now(),
          },
        ],
      });
    }
  };

  const formatValue = (value: any, depth = 0): React.ReactNode => {
    if (depth > 2) return '[...]';
    if (value === null) return <span style={{ color: '#666' }}>null</span>;
    if (value === undefined)
      return <span style={{ color: '#666' }}>undefined</span>;
    if (typeof value === 'string')
      return <span style={{ color: '#4ECDC4' }}>"{value}"</span>;
    if (typeof value === 'number')
      return <span style={{ color: '#FFD93D' }}>{value}</span>;
    if (typeof value === 'boolean')
      return <span style={{ color: '#FF6B6B' }}>{String(value)}</span>;
    if (typeof value === 'function')
      return <span style={{ color: '#A8A8A8' }}>[Function]</span>;
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      if (value.length > 3) return `[${value.length} items]`;
      return `[${value.map((v) => formatValue(v, depth + 1)).join(', ')}]`;
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) return '{}';
      if (keys.length > 3) return `{${keys.length} keys}`;
      return (
        <span>
          {'{'}
          {keys.slice(0, 2).map((key, i) => (
            <span key={key}>
              {i > 0 && ', '}
              <span style={{ color: '#FFD93D' }}>{key}</span>:{' '}
              {formatValue(value[key], depth + 1)}
            </span>
          ))}
          {keys.length > 2 && ', ...'}
          {'}'}
        </span>
      );
    }
    return String(value);
  };

  if (!state.isOpen) return null;

  const buttonStyle = {
    background: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    color: 'rgb(255, 255, 255)',
    fontSize: '11px',
    padding: '5px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    transition: 'all 0.2s ease',
  };

  const activeButtonStyle = {
    ...buttonStyle,
    background: 'rgba(78, 205, 196, 0.15)',
    color: 'rgb(78, 205, 196)',
    borderColor: 'rgba(78, 205, 196, 0.3)',
  };

  const selectedBreakpoint = state.breakpoints.find(
    (bp) => bp.id === state.selectedBreakpoint
  );
  const showInspector = true; // Always show inspector panel

  return (
    <div
      data-debugger-widget
      style={{
        width: showInspector ? '720px' : '420px',
        background: 'rgba(15, 15, 15, 0.98)',
        color: 'rgb(255, 255, 255)',
        fontFamily:
          "'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace",
        fontSize: '12px',
        borderRadius: '8px',
        zIndex: 999999,
        display: 'flex',
        flexDirection: 'row',
        border: state.isPaused
          ? '1px solid rgba(78, 205, 196, 0.4)'
          : '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(8px)',
        transition: 'width 0.3s ease',
      }}
    >
      {/* Main Panel */}
      <div
        style={{
          width: '420px',
          display: 'flex',
          flexDirection: 'column',
          borderRight: showInspector
            ? '1px solid rgba(255, 255, 255, 0.1)'
            : 'none',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            background: state.isPaused
              ? 'rgba(78, 205, 196, 0.03)'
              : 'transparent',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontWeight: '600', fontSize: '13px' }}>
              React Debugger
            </span>
            {!isConnected && (
              <span
                style={{
                  background: 'rgba(220, 53, 69, 0.15)',
                  color: 'rgb(220, 53, 69)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '10px',
                  fontWeight: '500',
                  border: '1px solid rgba(220, 53, 69, 0.3)',
                }}
              >
                DISCONNECTED
              </span>
            )}
            {isConnected && (
              <span
                style={{
                  background: 'rgba(78, 205, 196, 0.15)',
                  color: 'rgb(78, 205, 196)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '10px',
                  fontWeight: '500',
                  border: '1px solid rgba(78, 205, 196, 0.3)',
                }}
              >
                CONNECTED
              </span>
            )}
            {state.isPaused && (
              <span
                style={{
                  background: 'rgba(78, 205, 196, 0.15)',
                  color: 'rgb(78, 205, 196)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '10px',
                  fontWeight: '500',
                  border: '1px solid rgba(78, 205, 196, 0.3)',
                }}
              >
                PAUSED
              </span>
            )}
          </div>
          <button
            onClick={() => onStateChange({ ...state, isOpen: false })}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '16px',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.2s ease',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = 'rgb(255, 255, 255)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)')
            }
          >
            ×
          </button>
        </div>

        {/* Controls */}
        <div
          style={{
            display: 'flex',
            gap: '6px',
            padding: '12px 16px',
            flexWrap: 'wrap',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <button
            onClick={toggleBreakpointMode}
            disabled={state.isPaused}
            style={{
              ...buttonStyle,
              ...(state.isAddingBreakpoints ? activeButtonStyle : {}),
              opacity: state.isPaused ? 0.5 : 1,
              cursor: state.isPaused ? 'not-allowed' : 'pointer',
              ...(state.isAddingBreakpoints && {
                border: '1px solid rgb(78, 205, 196)',
              }),
            }}
            onMouseEnter={(e) => {
              if (!state.isPaused) {
                if (state.isAddingBreakpoints) {
                  // When active, keep solid turquoise border
                  e.currentTarget.style.border = '1px solid rgb(78, 205, 196)';
                } else {
                  // When inactive but enabled, show hover state
                  e.currentTarget.style.background = 'rgba(78, 205, 196, 0.08)';
                  e.currentTarget.style.border =
                    '1px solid rgba(78, 205, 196, 0.6)';
                }
              }
            }}
            onMouseLeave={(e) => {
              if (!state.isPaused) {
                if (state.isAddingBreakpoints) {
                  // When active, keep solid turquoise border
                  e.currentTarget.style.border = '1px solid rgb(78, 205, 196)';
                } else {
                  // Reset to default state
                  e.currentTarget.style.background =
                    'rgba(255, 255, 255, 0.08)';
                  e.currentTarget.style.border =
                    '1px solid rgba(255, 255, 255, 0.15)';
                }
              }
            }}
          >
            {state.isAddingBreakpoints
              ? '● Add Breakpoint'
              : '○ Add Breakpoint'}
          </button>

          <button
            onClick={() => toggleSection('logs')}
            style={state.sections.logs ? activeButtonStyle : buttonStyle}
          >
            Logs {state.sections.logs ? '▼' : '▶'}
          </button>
          <button
            onClick={() => toggleSection('breakpoints')}
            style={state.sections.breakpoints ? activeButtonStyle : buttonStyle}
          >
            Breakpoints ({state.breakpoints.length}){' '}
            {state.sections.breakpoints ? '▼' : '▶'}
          </button>
          <button
            onClick={() => toggleSection('components')}
            style={state.sections.components ? activeButtonStyle : buttonStyle}
          >
            Tree {state.sections.components ? '▼' : '▶'}
          </button>
        </div>

        {/* Debug Controls - always visible when paused */}
        {state.isPaused && (
          <div
            style={{
              display: 'flex',
              gap: '6px',
              padding: '12px 16px',
              background: 'rgba(78, 205, 196, 0.05)',
              borderBottom: '1px solid rgba(78, 205, 196, 0.2)',
              alignItems: 'center',
            }}
          >
            <div
              style={{ flex: 1, fontSize: '11px', color: 'rgb(78, 205, 196)' }}
            >
              {state.currentBreakpoint && (
                <span>
                  Hit: {state.currentBreakpoint.component}:
                  {state.currentBreakpoint.line}
                </span>
              )}
            </div>
            <button
              onClick={resumeExecution}
              style={{
                background: 'rgba(78, 205, 196, 0.15)',
                border: '1px solid rgba(78, 205, 196, 0.3)',
                color: 'rgb(78, 205, 196)',
                fontSize: '10px',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontWeight: '500',
              }}
            >
              ▶ Resume
            </button>
            <button
              onClick={stepOver}
              style={{
                background: 'rgba(108, 117, 125, 0.15)',
                border: '1px solid rgba(108, 117, 125, 0.3)',
                color: 'rgba(255, 255, 255, 0.8)',
                fontSize: '10px',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
            >
              ⏯ Step
            </button>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: '1 1 0%', overflowY: 'auto', padding: '0' }}>
          {/* Logs Section */}
          {state.sections.logs && (
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontWeight: '500',
                  }}
                >
                  Logs ({state.logs.length})
                </span>
                <button
                  onClick={clearLogs}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.4)',
                    fontSize: '10px',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    padding: '2px 4px',
                    borderRadius: '2px',
                  }}
                >
                  Clear
                </button>
              </div>
              <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                {state.logs.slice(-10).map((log, i) => (
                  <div
                    key={i}
                    style={{
                      marginBottom: '6px',
                      padding: '4px 0',
                      fontSize: '11px',
                      lineHeight: '1.3',
                    }}
                  >
                    <span
                      style={{
                        color:
                          log.type === 'info'
                            ? 'rgb(78, 205, 196)'
                            : log.type === 'warn'
                            ? 'rgb(255, 193, 7)'
                            : 'rgb(220, 53, 69)',
                        fontWeight: '500',
                        marginRight: '8px',
                        fontSize: '10px',
                      }}
                    >
                      {log.type.toUpperCase()}
                    </span>
                    <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Breakpoints Section */}
          {state.sections.breakpoints && (
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontWeight: '500',
                  }}
                >
                  Breakpoints ({state.breakpoints.length})
                </span>
                <button
                  onClick={clearBreakpoints}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.4)',
                    fontSize: '10px',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    padding: '2px 4px',
                    borderRadius: '2px',
                  }}
                >
                  Clear All
                </button>
              </div>

              {state.breakpoints.map((bp) => {
                const isCurrentlyHit = state.currentBreakpoint?.id === bp.id;
                const isSelected = state.selectedBreakpoint === bp.id;

                return (
                  <div
                    key={bp.id}
                    style={{
                      marginBottom: '6px',
                      background: isSelected
                        ? 'rgba(255, 255, 255, 0.08)'
                        : 'rgba(255, 255, 255, 0.03)',
                      border: isSelected
                        ? '1px solid rgba(255, 255, 255, 0.2)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '6px',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Breakpoint Header */}
                    <div
                      style={{
                        padding: '8px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                      }}
                      onClick={() => selectBreakpoint(bp.id)}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          flex: 1,
                        }}
                      >
                        {/* Status indicator */}
                        <div
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: isCurrentlyHit
                              ? 'rgb(78, 205, 196)' // Teal for hit
                              : bp.enabled
                              ? 'rgba(255, 255, 255, 0.8)' // White for enabled
                              : 'rgba(255, 255, 255, 0.3)', // Gray for disabled
                            flexShrink: 0,
                          }}
                        />

                        {/* Breakpoint info */}
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: '11px',
                              fontWeight: '500',
                              color: isCurrentlyHit
                                ? 'rgb(78, 205, 196)'
                                : bp.enabled
                                ? 'rgba(255, 255, 255, 0.9)'
                                : 'rgba(255, 255, 255, 0.5)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            {bp.component}:{bp.line}
                            {isCurrentlyHit && (
                              <span
                                style={{
                                  fontSize: '9px',
                                  color: 'rgba(78, 205, 196, 0.7)',
                                  fontWeight: 'normal',
                                }}
                              >
                                (hit)
                              </span>
                            )}
                            {!bp.enabled && (
                              <span
                                style={{
                                  fontSize: '9px',
                                  color: 'rgba(255, 255, 255, 0.5)',
                                  fontWeight: 'normal',
                                }}
                              >
                                (disabled)
                              </span>
                            )}
                          </div>
                          {bp.condition && (
                            <div
                              style={{
                                fontSize: '10px',
                                color: 'rgba(255, 255, 255, 0.5)',
                                marginTop: '2px',
                              }}
                            >
                              {bp.condition}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Breakpoint controls */}
                      <div
                        style={{
                          display: 'flex',
                          gap: '4px',
                          marginLeft: '8px',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => toggleBreakpoint(bp.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: bp.enabled
                              ? 'rgba(78, 205, 196, 0.8)'
                              : 'rgba(255, 255, 255, 0.4)',
                            fontSize: '11px',
                            cursor: 'pointer',
                            padding: '2px',
                            borderRadius: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            fontWeight: 'bold',
                          }}
                          title={
                            bp.enabled
                              ? 'Disable breakpoint'
                              : 'Enable breakpoint'
                          }
                        >
                          {bp.enabled ? '✓' : '○'}
                        </button>
                        <button
                          onClick={() => removeBreakpoint(bp.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'rgba(220, 53, 69, 0.7)',
                            fontSize: '12px',
                            cursor: 'pointer',
                            padding: '2px',
                            borderRadius: '2px',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          title="Remove breakpoint"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Components Section */}
          {state.sections.components && (
            <div style={{ padding: '12px 16px' }}>
              <div
                style={{
                  fontSize: '11px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  fontWeight: '500',
                  marginBottom: '8px',
                }}
              >
                Component Tree
              </div>
              <div
                style={{
                  fontSize: '11px',
                  lineHeight: '1.5',
                  fontFamily: 'monospace',
                }}
              >
                <div style={{ color: 'rgba(255, 255, 255, 0.8)' }}>▼ App</div>
                <div
                  style={{
                    paddingLeft: '12px',
                    color: 'rgba(255, 255, 255, 0.7)',
                  }}
                >
                  ▼ Header
                </div>
                <div
                  style={{
                    paddingLeft: '24px',
                    color: 'rgba(255, 255, 255, 0.6)',
                  }}
                >
                  ○ Logo
                </div>
                <div
                  style={{
                    paddingLeft: '24px',
                    color: 'rgba(255, 255, 255, 0.6)',
                  }}
                >
                  ○ Navigation
                </div>
                <div
                  style={{
                    paddingLeft: '12px',
                    color: 'rgba(255, 255, 255, 0.7)',
                  }}
                >
                  ▼ Main
                </div>
                <div
                  style={{
                    paddingLeft: '24px',
                    color: 'rgba(255, 255, 255, 0.6)',
                  }}
                >
                  ○ UserProfile
                </div>
                <div
                  style={{
                    paddingLeft: '24px',
                    color: 'rgba(255, 255, 255, 0.6)',
                  }}
                >
                  ○ LoginForm
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Inspector Panel */}
      {showInspector && (
        <div
          style={{
            width: '300px',
            background: 'rgba(10, 10, 10, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid rgba(78, 205, 196, 0.2)',
            overflow: 'scroll',
          }}
        >
          {/* Inspector Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(78, 205, 196, 0.2)',
              background: 'rgba(78, 205, 196, 0.05)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: 'rgb(78, 205, 196)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span style={{ fontSize: '8px' }}>●</span>
                {selectedBreakpoint
                  ? `${selectedBreakpoint.component}:${selectedBreakpoint.line}`
                  : 'Inspector Panel'}
              </div>
              <button
                onClick={() =>
                  onStateChange({ ...state, selectedBreakpoint: undefined })
                }
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontSize: '14px',
                  cursor: 'pointer',
                  padding: '2px',
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Inspector Content */}
          <div
            style={{ flex: '1 1 0%', overflowY: 'auto', padding: '12px 16px' }}
          >
            <div style={{ fontSize: '11px', lineHeight: '1.4' }}>
              {state.capturedData ? (
                <>
                  {/* Props */}
                  {Object.keys(state.capturedData.props).length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div
                        style={{
                          fontWeight: '600',
                          color: 'rgba(255, 255, 255, 0.8)',
                          marginBottom: '8px',
                        }}
                      >
                        Props
                      </div>
                      <div
                        style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                        }}
                      >
                        {Object.entries(state.capturedData.props).map(
                          ([key, value]) => (
                            <div key={key} style={{ marginBottom: '6px' }}>
                              <div
                                style={{
                                  color: 'rgba(255, 165, 0, 0.9)',
                                  fontWeight: '500',
                                  marginBottom: '2px',
                                }}
                              >
                                {key}:
                              </div>
                              <div
                                style={{
                                  color: 'rgba(255, 255, 255, 0.7)',
                                  paddingLeft: '8px',
                                }}
                              >
                                {formatValue(value)}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {/* State */}
                  {Object.keys(state.capturedData.state).length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div
                        style={{
                          fontWeight: '600',
                          color: 'rgba(255, 255, 255, 0.8)',
                          marginBottom: '8px',
                        }}
                      >
                        State
                      </div>
                      <div
                        style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                        }}
                      >
                        {Object.entries(state.capturedData.state).map(
                          ([key, value]) => (
                            <div key={key} style={{ marginBottom: '6px' }}>
                              <div
                                style={{
                                  color: 'rgba(255, 165, 0, 0.9)',
                                  fontWeight: '500',
                                  marginBottom: '2px',
                                }}
                              >
                                {key}:
                              </div>
                              <div
                                style={{
                                  color: 'rgba(255, 255, 255, 0.7)',
                                  paddingLeft: '8px',
                                }}
                              >
                                {formatValue(value)}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {/* Hooks */}
                  {state.capturedData.hooks.length > 0 && (
                    <div>
                      <div
                        style={{
                          fontWeight: '600',
                          color: 'rgba(255, 255, 255, 0.8)',
                          marginBottom: '8px',
                        }}
                      >
                        Hooks ({state.capturedData.hooks.length})
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: '4px',
                          flexWrap: 'wrap',
                        }}
                      >
                        {state.capturedData.hooks.map((hook, index) => (
                          <span
                            key={index}
                            style={{
                              background: 'rgba(78, 205, 196, 0.1)',
                              color: 'rgba(78, 205, 196, 0.9)',
                              padding: '2px 6px',
                              borderRadius: '3px',
                              fontSize: '10px',
                              border: '1px solid rgba(78, 205, 196, 0.2)',
                            }}
                          >
                            {hook.type}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div
                  style={{
                    color: 'rgba(255, 255, 255, 0.6)',
                    textAlign: 'center',
                    padding: '20px',
                    fontSize: '11px',
                  }}
                >
                  Waiting for breakpoint...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Main debugger widget component
export function DebuggerWidget() {
  // CDP connection state
  const [cdpSocket, setCdpSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messageId, setMessageId] = useState(0);
  const pendingMessages = useRef(
    new Map<number, { resolve: Function; reject: Function }>()
  );

  // Debugger state
  const [debuggerState, setDebuggerState] = useState<DebuggerState>({
    isOpen: true,
    isPaused: false,
    isAddingBreakpoints: false,
    sections: {
      logs: true,
      breakpoints: false,
      components: false,
    },
    logs: [
      {
        type: 'info',
        message: 'Debugger widget initialized',
        timestamp: Date.now(),
      },
    ],
    breakpoints: [],
  });

  // Component selection from main app
  const [selectedComponent, setSelectedComponent] =
    useState<ComponentInfo | null>(null);

  // Connect to CDP
  useEffect(() => {
    connectToCDP();
  }, []);

  // Send initial breakpoints to overlay
  useEffect(() => {
    window.parent.postMessage(
      {
        type: 'updateBreakpoints',
        payload: { breakpoints: debuggerState.breakpoints },
      },
      '*'
    );
  }, []);

  const enableCDPDomains = async (ws: WebSocket) => {
    try {
      console.log('Enabling CDP domains...');

      // Enable Runtime domain
      const runtimeResult = await sendCDPCommandDirect(ws, 'Runtime.enable');
      console.log('Runtime.enable result:', runtimeResult);

      // Enable Debugger domain
      const debuggerResult = await sendCDPCommandDirect(ws, 'Debugger.enable');
      console.log('Debugger.enable result:', debuggerResult);

      addLog('info', 'CDP domains enabled successfully');
    } catch (error) {
      console.error('Failed to enable CDP domains:', error);
      addLog('error', `Failed to enable CDP domains: ${error}`);
    }
  };

  const sendCDPCommandDirect = (
    ws: WebSocket,
    method: string,
    params: any = {}
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not ready'));
        return;
      }

      const id = messageId + 1;
      setMessageId(id);
      pendingMessages.current.set(id, { resolve, reject });

      const message = {
        id,
        method,
        params,
      };

      console.log('Sending CDP command directly:', message);
      ws.send(JSON.stringify(message));
    });
  };

  const connectToCDP = async () => {
    try {
      // Get list of targets via CORS proxy
      const resp = await fetch('http://127.0.0.1:5679/cdp/list');
      const targets = await resp.json();

      console.log('Available targets:', targets);

      // Look for your app page
      const page = targets.find((t: any) => {
        const isPage = t.type === 'page';
        const hasLocalhost = t.url && t.url.includes('localhost:5173');
        return isPage && hasLocalhost;
      });

      if (!page) {
        addLog(
          'error',
          'No page target found for localhost:5173. Make sure Chrome is open to the app.'
        );
        return;
      }

      console.log('Connecting to app page:', page.url);

      // Extract target ID from the WebSocket URL
      const targetId = page.id;

      // Connect to our WebSocket proxy instead of directly to CDP
      const ws = new WebSocket('ws://127.0.0.1:5679/ws');

      // Store the WebSocket connection
      setCdpSocket(ws);

      ws.addEventListener('open', () => {
        console.log('Connected to WebSocket proxy');

        // Send connection request to proxy
        ws.send(
          JSON.stringify({
            type: 'CONNECT_CDP',
            targetId: targetId,
          })
        );
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        // Handle proxy control messages
        if (msg.type === 'CDP_CONNECTED') {
          console.log('Connected to Chrome CDP via proxy');
          setIsConnected(true);
          addLog('info', 'Connected to Chrome CDP');

          // Enable required domains immediately using the local WebSocket
          console.log('Attempting to enable CDP domains...');
          console.log('WebSocket state:', ws.readyState);

          // Use the local WebSocket directly instead of state
          enableCDPDomains(ws);
          return;
        }

        if (msg.type === 'CDP_ERROR') {
          console.error('CDP connection error:', msg.error);
          addLog('error', `CDP connection error: ${msg.error}`);
          return;
        }

        if (msg.type === 'CDP_CLOSED') {
          console.log('CDP connection closed');
          setIsConnected(false);
          addLog('warn', 'CDP connection closed');
          return;
        }

        // Handle CDP command responses
        if (msg.id && pendingMessages.current.has(msg.id)) {
          const { resolve, reject } = pendingMessages.current.get(msg.id)!;
          pendingMessages.current.delete(msg.id);

          if (msg.error) {
            console.error('CDP command failed:', msg.error);
            reject(new Error(msg.error.message));
          } else {
            console.log('CDP command succeeded:', msg.result);
            resolve(msg.result);
          }
          return;
        }

        // Handle Debugger.paused event
        if (msg.method === 'Debugger.paused') {
          console.log('CDP Debugger.paused:', msg.params);

          // Extract breakpoint info from the pause event
          const callFrame = msg.params.callFrames?.[0];
          const breakpointInfo = {
            id: Date.now().toString(), // Generate a unique ID
            component: callFrame?.functionName || 'Unknown',
            line: (callFrame?.location?.lineNumber || 0) + 1, // Convert to 1-based
            timestamp: Date.now(),
          };

          // Update state with pause info and automatically select the breakpoint
          setDebuggerState((prev) => {
            const newState = {
              ...prev,
              isPaused: true,
              currentBreakpoint: breakpointInfo,
              selectedBreakpoint: breakpointInfo.id, // Auto-select to show inspector
              sections: { ...prev.sections, breakpoints: true },
              capturedData: {
                props: {
                  title: 'Sample Component',
                  count: 42,
                  isActive: true,
                },
                state: {
                  loading: false,
                  data: { id: 1, name: 'Test Item' },
                  error: null,
                },
                context: {
                  theme: 'dark',
                  user: { id: 123, name: 'John Doe' },
                },
                hooks: [
                  { type: 'useState', value: false, index: 0 },
                  { type: 'useEffect', value: undefined, index: 1 },
                  { type: 'useContext', value: { theme: 'dark' }, index: 2 },
                ],
                renderCount: 15,
                lastRenderTime: Date.now(),
              },
            };

            // Immediately send size update to parent before pause takes effect
            setTimeout(() => {
              const debuggerElement = document.querySelector(
                '[data-debugger-widget]'
              ) as HTMLElement;
              if (debuggerElement) {
                const rect = debuggerElement.getBoundingClientRect();
                window.parent.postMessage(
                  {
                    type: 'DEBUGGER_SIZE',
                    payload: {
                      width: Math.ceil(rect.width),
                      height: Math.ceil(rect.height),
                    },
                  },
                  '*'
                );
              }
            }, 0);

            return newState;
          });

          addLog(
            'info',
            `Paused: ${msg.params.reason || 'breakpoint'} at ${
              breakpointInfo.component
            }:${breakpointInfo.line}`
          );
        }

        // Handle Debugger.resumed event
        if (msg.method === 'Debugger.resumed') {
          setDebuggerState((prev) => ({
            ...prev,
            isPaused: false,
            currentBreakpoint: undefined,
            selectedBreakpoint: undefined,
            capturedData: undefined,
          }));
          addLog('info', 'Execution resumed');
        }

        // Handle breakpoint responses
        if (msg.id && msg.result && msg.result.breakpointId) {
          addLog(
            'info',
            `Breakpoint set successfully: ${msg.result.breakpointId}`
          );
        }
      });

      ws.addEventListener('close', () => {
        console.log('WebSocket proxy closed');
        setIsConnected(false);
        addLog('warn', 'CDP connection closed');
      });

      ws.addEventListener('error', (e) => {
        console.error('WebSocket proxy error:', e);
        addLog('error', 'CDP connection error');
      });
    } catch (e) {
      console.error('Failed to connect to CDP:', e);
      addLog('error', `Failed to connect to CDP: ${e}`);
    }
  };

  const sendCDPCommand = (method: string, params: any = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
      console.log('sendCDPCommand called with:', method);
      console.log('cdpSocket:', cdpSocket);
      console.log('cdpSocket readyState:', cdpSocket?.readyState);
      console.log('isConnected:', isConnected);

      if (!cdpSocket || cdpSocket.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not ready:', {
          cdpSocket: !!cdpSocket,
          readyState: cdpSocket?.readyState,
          expectedState: WebSocket.OPEN,
        });
        reject(new Error('Proxy WebSocket not connected'));
        return;
      }

      if (!isConnected) {
        console.error('CDP connection not established');
        reject(new Error('CDP connection not established'));
        return;
      }

      const id = messageId + 1;
      setMessageId(id);
      pendingMessages.current.set(id, { resolve, reject });

      const message = {
        id,
        method,
        params,
      };

      console.log('Sending CDP command:', message);
      cdpSocket.send(JSON.stringify(message));
    });
  };

  const addLog = (type: 'info' | 'warn' | 'error', message: string) => {
    setDebuggerState((prev) => ({
      ...prev,
      logs: [...prev.logs, { type, message, timestamp: Date.now() }].slice(-50),
    }));
  };

  const setBreakpoint = async (
    file: string,
    line: number,
    componentName: string
  ) => {
    try {
      const result = await sendCDPCommand('Debugger.setBreakpointByUrl', {
        lineNumber: line - 1, // CDP uses 0-based line numbers
        url: file,
        columnNumber: 0,
      });

      if (result.breakpointId) {
        setDebuggerState((prev) => ({
          ...prev,
          breakpoints: [
            ...prev.breakpoints,
            {
              id: Date.now().toString(),
              component: componentName,
              line,
              enabled: true,
              breakpointId: result.breakpointId,
            },
          ],
        }));
        addLog('info', `Breakpoint set at ${componentName}:${line}`);

        // Send updated breakpoints to overlay
        window.parent.postMessage(
          {
            type: 'updateBreakpoints',
            payload: {
              breakpoints: [
                ...debuggerState.breakpoints,
                {
                  id: Date.now().toString(),
                  component: componentName,
                  line,
                  enabled: true,
                  breakpointId: result.breakpointId,
                },
              ],
            },
          },
          '*'
        );
      }
    } catch (error) {
      addLog('error', `Failed to set breakpoint: ${error}`);
    }
  };

  const removeBreakpoint = async (breakpointId: string) => {
    try {
      await sendCDPCommand('Debugger.removeBreakpoint', { breakpointId });
      setDebuggerState((prev) => {
        const newBreakpoints = prev.breakpoints.filter(
          (bp) => bp.breakpointId !== breakpointId
        );

        // Send updated breakpoints to overlay
        window.parent.postMessage(
          {
            type: 'updateBreakpoints',
            payload: { breakpoints: newBreakpoints },
          },
          '*'
        );

        return {
          ...prev,
          breakpoints: newBreakpoints,
        };
      });
      addLog('info', 'Breakpoint removed');
    } catch (error) {
      addLog('error', `Failed to remove breakpoint: ${error}`);
    }
  };

  const resumeExecution = async () => {
    try {
      await sendCDPCommand('Debugger.resume');
      setDebuggerState((prev) => ({
        ...prev,
        isPaused: false,
        currentBreakpoint: undefined,
        selectedBreakpoint: undefined,
        capturedData: undefined,
      }));
      addLog('info', 'Execution resumed');
    } catch (error) {
      addLog('error', `Failed to resume: ${error}`);
    }
  };

  const stepOver = async () => {
    try {
      await sendCDPCommand('Debugger.stepOver');
      addLog('info', 'Stepping over');
    } catch (error) {
      addLog('error', `Failed to step over: ${error}`);
    }
  };

  // Listen for messages from parent (main app)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;

      const { type, payload } = event.data;

      switch (type) {
        case 'SELECT_COMPONENT':
          setSelectedComponent(payload);
          if (debuggerState.isAddingBreakpoints && payload) {
            setBreakpoint(
              payload.sourceLocation.file,
              payload.sourceLocation.line,
              payload.name
            );
          }
          break;
        case 'TOGGLE_DEBUGGER':
          setDebuggerState((prev) => ({ ...prev, isOpen: !prev.isOpen }));
          break;
        case 'REQUEST_SIZE_UPDATE':
          // Trigger immediate size update
          const debuggerElement = document.querySelector(
            '[data-debugger-widget]'
          ) as HTMLElement;
          if (debuggerElement && debuggerState.isOpen) {
            const rect = debuggerElement.getBoundingClientRect();
            window.parent.postMessage(
              {
                type: 'DEBUGGER_SIZE',
                payload: {
                  width: Math.ceil(rect.width),
                  height: Math.ceil(rect.height),
                },
              },
              '*'
            );
          }
          break;
      }
    }

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [debuggerState.isAddingBreakpoints, debuggerState.isOpen]);

  // Handle size updates with ResizeObserver for automatic detection
  useEffect(() => {
    let resizeObserver: ResizeObserver | null = null;
    let timeoutId: NodeJS.Timeout | null = null;

    function postSize() {
      if (!debuggerState.isOpen) {
        window.parent.postMessage(
          {
            type: 'DEBUGGER_SIZE',
            payload: { width: 0, height: 0 },
          },
          '*'
        );
        return;
      }

      // Get the actual size of the debugger widget
      const debuggerElement = document.querySelector(
        '[data-debugger-widget]'
      ) as HTMLElement;
      if (debuggerElement) {
        const rect = debuggerElement.getBoundingClientRect();
        const sizeData = {
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
        };
        console.log('Debugger widget size:', sizeData);
        window.parent.postMessage(
          {
            type: 'DEBUGGER_SIZE',
            payload: sizeData,
          },
          '*'
        );
      } else {
        // If element not found, try again after a short delay
        setTimeout(postSize, 50);
      }
    }

    // Debounced postSize function to avoid excessive messages
    function debouncedPostSize() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(postSize, 16); // ~60fps
    }

    // Initial size post with retry logic
    const initialTimeout = setTimeout(() => {
      debouncedPostSize();
    }, 100);

    // Also listen for window resize events
    const handleWindowResize = () => {
      debouncedPostSize();
    };
    window.addEventListener('resize', handleWindowResize);

    // Set up ResizeObserver for automatic size detection
    const debuggerElement = document.querySelector(
      '[data-debugger-widget]'
    ) as HTMLElement;

    let mutationObserver: MutationObserver | null = null;

    if (debuggerElement && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        debouncedPostSize();
      });
      resizeObserver.observe(debuggerElement);
    } else if (debuggerElement) {
      // Fallback: use MutationObserver to detect DOM changes
      mutationObserver = new MutationObserver(() => {
        debouncedPostSize();
      });
      mutationObserver.observe(debuggerElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }

    return () => {
      clearTimeout(initialTimeout);
      window.removeEventListener('resize', handleWindowResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (mutationObserver) {
        mutationObserver.disconnect();
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [
    debuggerState.isOpen,
    debuggerState.selectedBreakpoint,
    debuggerState.currentBreakpoint,
    debuggerState.sections,
    debuggerState.logs.length,
    debuggerState.breakpoints.length,
  ]);

  // Immediate size update when debugger opens/closes or inspector state changes
  useEffect(() => {
    const updateSize = () => {
      if (!debuggerState.isOpen) {
        // Immediately hide when closed
        window.parent.postMessage(
          {
            type: 'DEBUGGER_SIZE',
            payload: { width: 0, height: 0 },
          },
          '*'
        );
        return;
      }

      // Small delay to ensure DOM is rendered
      const timeoutId = setTimeout(() => {
        const debuggerElement = document.querySelector(
          '[data-debugger-widget]'
        ) as HTMLElement;
        if (debuggerElement) {
          const rect = debuggerElement.getBoundingClientRect();
          window.parent.postMessage(
            {
              type: 'DEBUGGER_SIZE',
              payload: {
                width: Math.ceil(rect.width),
                height: Math.ceil(rect.height),
              },
            },
            '*'
          );
        }
      }, 50);

      return () => clearTimeout(timeoutId);
    };

    updateSize();
  }, [
    debuggerState.isOpen,
    debuggerState.selectedBreakpoint, // Inspector panel toggle
    debuggerState.currentBreakpoint, // Inspector panel toggle
  ]);

  const sendToParent = (type: string, payload?: any) => {
    window.parent.postMessage({ type, payload }, '*');
  };

  return (
    <DebuggerOverlayComponent
      state={debuggerState}
      onStateChange={setDebuggerState}
      cdpSocket={cdpSocket}
      isConnected={isConnected}
      sendCDPCommand={sendCDPCommand}
    />
  );
}

// Initialize the debugger widget
const root = createRoot(document.getElementById('root')!);
root.render(<DebuggerWidget />);
