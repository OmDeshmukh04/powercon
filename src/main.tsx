import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider, useDispatch } from 'react-redux';
import './index.css';
import App from './App';
import { store, type AppDispatch } from './redux/store';
import { bootstrapAuth } from './redux/authSlice';

function AppBootstrap() {
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    void dispatch(bootstrapAuth());
  }, [dispatch]);

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <AppBootstrap />
      </BrowserRouter>
    </Provider>
  </StrictMode>
);
