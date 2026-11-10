await import('./build.mjs');
const {createLocalServer} = await import('./local-server.mjs');
const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const server = await createLocalServer();
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Close the other server or set PORT to another port.`
    : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`\nCurrenc Connect → http://localhost:${port}\nData: .local/workspace.sqlite\nPress Ctrl+C to stop.\n`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close());
