import React, { useState, useEffect } from 'react';
import './App.css';

const FirstContext = React.createContext({});
const SecondContext = React.createContext({});
const ThirdContext = React.createContext({});

const FirstContextProvider = ({ children }) => (
  <FirstContext.Provider value={{}}>{children}</FirstContext.Provider>
);

const SecondContextProvider = ({ children }) => (
  <SecondContext.Provider value={{}}>{children}</SecondContext.Provider>
);

const ThirdContextProvider = ({ children }) => (
  <ThirdContext.Provider value={{}}>{children}</ThirdContext.Provider>
);

function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);

  // ❌ Common bug: missing 'count' in dependency array
  useEffect(() => {
    console.log('Counter useEffect running, setting up interval');
    const id = setInterval(() => {
      setCount((prevCount) => {
        console.log('Setting count from', prevCount, 'to', prevCount + 1);
        return prevCount + 1;
      });
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []); // Empty dependency array is fine since we're using functional updates

  console.log('Counter rendering with count:', count);
  return <div>Count: {count}</div>;
}

const flattenContextProviders = (providers) => {
  return providers.reduce(
    (acc, Provider) => {
      return ({ children }) => <Provider>{acc({ children })}</Provider>;
    },
    ({ children }) => <>{children}</>
  );
};

// Array of Context Providers.
const contextProviders = [
  FirstContextProvider,
  SecondContextProvider,
  ThirdContextProvider,
];

type Filters = { active: boolean };

const UserRow = React.memo(function UserRow({ filters }: { filters: Filters }) {
  return (
    <div style={{ padding: 4, border: '1px solid #ddd', marginTop: 6 }}>
      {filters.active ? 'active' : 'inactive'}
    </div>
  );
});

export default function App() {
  const [count, setCount] = useState(0);

  const badFilters = { active: count % 2 === 0 };

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>Identity Thrash Demo</h1>
      <p>
        Clicking increments a parent state; both children are wrapped in{' '}
        <code>React.memo</code>.
      </p>
      <button onClick={() => setCount((c) => c + 1)}>
        Increment ({count})
      </button>

      <UserRow filters={badFilters} />
    </div>
  );
}
