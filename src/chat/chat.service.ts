import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { ChatConversation, ChatMessage } from "./schemas/chat.schema";
import * as nodemailer from "nodemailer";
import { ChatGateway } from "./chat.gateway";

@Injectable()
export class ChatService {
    constructor(
        @InjectModel(ChatConversation.name)
        private conversationModel: Model<ChatConversation>,

        @InjectModel(ChatMessage.name)
        private messageModel: Model<ChatMessage>,

        private gateway: ChatGateway
    ) { }

    // tạo conversation nếu chưa có
    async getOrCreateConversation(sessionId: string, name?: string, email?: string, userId?: string) {
        let convo = await this.conversationModel.findOne({ sessionId });

        if (!convo) {
            convo = await this.conversationModel.create({
                sessionId,
                customerName: name,
                customerEmail: email,
                userId: userId ? new Types.ObjectId(userId) : null
            });

        }

        return convo;
    }

    // USER gửi tin nhắn
    async sendUserMessage(sessionId: string, content: string, name?: string, email?: string, userId?: string) {

        // init thì chỉ tạo conversation
        if (content === "__init__") {
            await this.getOrCreateConversation(sessionId, name, email, userId);
            return { ok: true };
        }

        const conversation = await this.getOrCreateConversation(sessionId, name, email, userId);

        await this.messageModel.create({
            conversationId: conversation._id,
            sender: "USER",
            content
        });

        // đánh dấu cho admin biết có tin chưa đọc
        await this.conversationModel.updateOne(
            { _id: conversation._id },
            { hasUnread: true }
        );

        return { ok: true };
    }



    // ADMIN gửi tin
    async adminReply(conversationId: string, content: string) {
        await this.conversationModel.updateOne(
            { _id: conversationId },
            {
                hasUnread: false,
                updatedAt: new Date() // 🔥 BẮT BUỘC
            }
        );


        return this.messageModel.create({
            conversationId,
            sender: "ADMIN",
            content
        });
    }


    // lấy lịch sử chat
    async getMessages(conversationId: string) {
        return this.messageModel
            .find({ conversationId: new Types.ObjectId(conversationId) })
            .sort({ createdAt: 1 })
            .lean();
    }


    // admin: danh sách conversation
    async getAllConversations() {
        return this.conversationModel
            .find()
            .populate("userId", "name email")
            .sort({ updatedAt: -1 })
            .lean();
    }


    // gửi email khi có tin mới
    async sendEmailNotify(convo: ChatConversation, message: string) {
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        await transporter.sendMail({
            from: '"Sunshine Melody" <no-reply@music.vn>',
            to: process.env.ADMIN_EMAIL,
            subject: "Khách hàng vừa nhắn tin",
            text: `
Khách: ${convo.customerName ?? convo.sessionId}
Email: ${convo.customerEmail ?? "Không có"}
Tin nhắn: ${message}
            `
        });
    }
}
