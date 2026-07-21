import { mount } from 'svelte';
import App from './App.svelte';
import './styles/app.css';
import { session } from './lib/gameSession.svelte.ts';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Missing #app mount point');
}

mount(App, { target });

session.init().catch((error: unknown) => {
  console.error(error);
});
