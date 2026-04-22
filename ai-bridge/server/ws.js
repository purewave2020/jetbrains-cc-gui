export function createWsHandler(wss) {
  return {
    handleConnection(ws, request) {
      console.log('[ws] Client connected');
      ws.on('message', (data) => {
        console.log('[ws] Received:', data.toString());
        ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
      });
      ws.on('close', () => {
        console.log('[ws] Client disconnected');
      });
    },
  };
}
