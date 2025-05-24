import { Server, ServerWebSocket } from "bun";

// Store clients by channel
const channels = new Map<string, Set<ServerWebSocket<any>>>();

function handleConnection(ws: ServerWebSocket<any>) {
  // Don't add to clients immediately - wait for channel join
  console.log("New client connected");

  // Send welcome message to the new client
  ws.send(JSON.stringify({
    type: "system",
    message: "Please join a channel to start chatting",
  }));

  ws.close = () => {
    console.log("Client disconnected");

    // Remove client from their channel
    channels.forEach((clients, channelName) => {
      if (clients.has(ws)) {
        clients.delete(ws);

        // Notify other clients in same channel
        clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: "system",
              message: "A user has left the channel",
              channel: channelName
            }));
          }
        });
      }
    });
  };
}

const server = Bun.serve({
  port: 3055,
  // uncomment this to allow connections in windows wsl
  // hostname: "0.0.0.0",
  fetch(req: Request, server: Server) {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Handle WebSocket upgrade
    const success = server.upgrade(req, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });

    if (success) {
      return; // Upgraded to WebSocket
    }

    // Return response for non-WebSocket requests
    return new Response("WebSocket server running", {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
  websocket: {
    open: handleConnection,
    message(ws: ServerWebSocket<any>, message: string | Buffer) {
      try {
        console.log("Raw message received from client:", message);
        const data = JSON.parse(message as string);
        console.log("Parsed message data:", JSON.stringify(data, null, 2));

        if (data.type === "join") {
          const channelName = data.channel;
          console.log("Join request for channel:", channelName);
          console.log("Request ID:", data.id);
          
          if (!channelName || typeof channelName !== "string") {
            console.log("ERROR: Invalid channel name");
            ws.send(JSON.stringify({
              type: "error",
              message: "Channel name is required"
            }));
            return;
          }

          // Create channel if it doesn't exist
          if (!channels.has(channelName)) {
            channels.set(channelName, new Set());
            console.log("Created new channel:", channelName);
          }

          // Add client to channel
          const channelClients = channels.get(channelName)!;
          channelClients.add(ws);
          console.log("Added client to channel. Channel now has", channelClients.size, "clients");

          // Notify client they joined successfully
          const joinSuccessMessage = {
            type: "system",
            message: `Joined channel: ${channelName}`,
            channel: channelName
          };
          console.log("Sending join success message:", JSON.stringify(joinSuccessMessage, null, 2));
          ws.send(JSON.stringify(joinSuccessMessage));

          console.log("Preparing MCP response for request ID:", data.id);

          // This is the response the MCP server expects
          const mcpResponse = {
            type: "system",
            message: {
              id: data.id,
              result: "Connected to channel: " + channelName,
              error: null
            },
            channel: channelName
          };

          console.log("Sending MCP response:", JSON.stringify(mcpResponse, null, 2));
          ws.send(JSON.stringify(mcpResponse));

          // Notify other clients in channel
          channelClients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              const notificationMessage = {
                type: "system",
                message: "A new user has joined the channel",
                channel: channelName
              };
              console.log("Sending notification to other clients:", JSON.stringify(notificationMessage));
              client.send(JSON.stringify(notificationMessage));
            }
          });
          return;
        }

        // Handle regular messages
        if (data.type === "message") {
          console.log("Processing regular message for channel:", data.channel);
          const channelName = data.channel;
          if (!channelName || typeof channelName !== "string") {
            console.log("ERROR: No channel specified for message");
            ws.send(JSON.stringify({
              type: "error",
              message: "Channel name is required"
            }));
            return;
          }

          const channelClients = channels.get(channelName);
          if (!channelClients || !channelClients.has(ws)) {
            console.log("ERROR: Client not in channel", channelName);
            ws.send(JSON.stringify({
              type: "error",
              message: "You must join the channel first"
            }));
            return;
          }

          // Send back a proper response with the same ID
          const response = {
            type: "response",
            id: data.id,
            message: {
              result: "Command received",
              error: null
            },
            channel: channelName
          };
          console.log("Sending response:", JSON.stringify(response, null, 2));
          ws.send(JSON.stringify(response));

          // Also broadcast to other clients in the channel
          console.log("Broadcasting message to", channelClients.size - 1, "other clients in channel:", channelName);
          channelClients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              const broadcastMessage = {
                type: "broadcast",
                message: data.message,
                sender: "User",
                channel: channelName
              };
              console.log("Broadcasting to client:", JSON.stringify(broadcastMessage, null, 2));
              client.send(JSON.stringify(broadcastMessage));
            }
          });
        }
      } catch (err) {
        console.error("Error handling message:", err);
        console.error("Error stack:", err instanceof Error ? err.stack : 'No stack trace');
      }
    },
    close(ws: ServerWebSocket<any>) {
      // Remove client from their channel
      channels.forEach((clients) => {
        clients.delete(ws);
      });
    }
  }
});

console.log(`WebSocket server running on port ${server.port}`);
