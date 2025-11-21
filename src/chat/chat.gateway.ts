import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: any) {
    console.log(`⚡ Client connected: ${client.id}`);
  }

  handleDisconnect(client: any) {
    console.log(`❌ Client disconnected: ${client.id}`);
  }

  // Hàm dùng để bắn socket ra toàn hệ thống
  emitNewMessage(payload: any) {
    this.server.emit("new_message", payload);
  }
}
