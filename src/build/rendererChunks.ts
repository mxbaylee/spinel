// Keep language dictionaries with the lazy renderer without capturing shared UI
// dependencies: otherwise anonymous entry imports the entire renderer for them.
// Rolldown's execution-order guard preserves initialization across split chunks.
export const rendererOutput = {
  strictExecutionOrder: true,
  codeSplitting: {
    groups: [
      { name: 'module-preload', test: /vite\/preload-helper\.js/ },
      {
        name: 'univer-renderer',
        test: /node_modules[\\/]@univerjs[\\/]engine-render[\\/]/,
        includeDependenciesRecursively: false,
      },
    ],
  },
};
