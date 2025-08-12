import { useState, useEffect } from 'react';
import './App.css';

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

function App() {
  return <Counter data-debug-id={'1'} start={0} />;
}

export default App;
