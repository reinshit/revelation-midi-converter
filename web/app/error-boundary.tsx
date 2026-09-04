import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface State { failed: boolean }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The application encountered an unrecoverable UI error.', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <section role="alert" className="max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">The application could not continue</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your MIDI files remain on this device and were not uploaded.</p>
          <button type="button" className="mt-5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => window.location.reload()}>
            Reload application
          </button>
        </section>
      </main>
    );
  }
}
