import { useState, useEffect } from 'react';
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';
import './App.css';

// function App() {
//   console.log('Hello from App!');
//   const [count, setCount] = useState(0);

//   return (
//     <>
//       <div>
//         <a href="https://vite.dev" target="_blank">
//           <img src={viteLogo} className="logo" alt="Vite logo" />
//         </a>
//         <a href="https://react.dev" target="_blank">
//           <img src={reactLogo} className="logo react" alt="React logo" />
//         </a>
//       </div>
//       <h1>Vite + React</h1>
//       <div className="card">
//         <button onClick={() => setCount((count) => count + 1)}>
//           count is {count}
//         </button>
//         <p>
//           Edit <code>src/App.tsx</code> and save to test HMR
//         </p>
//       </div>
//       <p className="read-the-docs">
//         Click on the Vite and React logos to learn more
//       </p>
//       <Child1 />
//       <Child2 />
//     </>
//   );
// }

// export default App;
// function Child1() {
//   return <div>Child1</div>;
// }

// function Child2() {
//   return <div>Child2</div>;
// }

function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);

  // ❌ Common bug: missing 'count' in dependency array
  useEffect(() => {
    const id = setInterval(() => {
      setCount(count + 1); // 'count' is always the initial value!
    }, 1000);
    return () => clearInterval(id);
  }, [count]); // <-- should be [count] or use functional update

  return <div>Count: {count}</div>;
}

function App() {
  return <Counter start={0} />;
}

export default App;
