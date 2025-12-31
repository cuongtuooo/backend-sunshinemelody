import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Order, OrderDocument } from './schemas/order.schema';
import { SoftDeleteModel } from 'soft-delete-plugin-mongoose';
import { CreateOrderDto } from './dto/create-order.dto';
import mongoose, { Types } from 'mongoose';
import { IUser } from 'src/users/users.interface';
import aqp from 'api-query-params';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { Product, ProductDocument } from 'src/products/schemas/products.schemas';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name)
    private orderModel: SoftDeleteModel<OrderDocument>,

    @InjectModel(Product.name)
    private productModel: SoftDeleteModel<ProductDocument>,
  ) { }

  // ---------------- CREATE ----------------
  async create(createOrderDto: CreateOrderDto, user: IUser) {
    // 1. Kiểm tra tồn kho từng sản phẩm
    for (const item of createOrderDto.detail) {
      const product = await this.productModel.findById(item._id);
      if (!product) {
        throw new BadRequestException(`Sản phẩm với id ${item._id} không tồn tại`);
      }

      if (product.quantity < item.quantity) {
        throw new BadRequestException(
          `Sản phẩm "${product.name}" chỉ còn ${product.quantity} sản phẩm`,
        );
      }
    }

    // 2. Trừ tồn kho (giữ hàng) ngay khi tạo đơn pending
    for (const item of createOrderDto.detail) {
      await this.productModel.updateOne(
        { _id: item._id },
        {
          $inc: {
            quantity: -item.quantity, // trừ kho
          },
        },
      );
    }

    // 3. Tạo đơn ở trạng thái "pending"
    const newOrder = await this.orderModel.create({
      ...createOrderDto,
      status: 'pending',
      createdBy: {
        _id: user._id,
        email: user.email,
      },
    });

    return {
      id: newOrder._id,
      createdAt: newOrder.createdAt,
      status: newOrder.status,
    };
  }

  // ---------------- LIST (paging + filter) ----------------
  async findAll(currentPage: number, limit: number, qs: any) {
    const { filter, sort, projection, population } = aqp(qs);
    delete filter.current;
    delete filter.pageSize;

    const page = Number.isFinite(+currentPage) && +currentPage > 0 ? +currentPage : 1;
    const pageSize = Number.isFinite(+limit) && +limit > 0 ? +limit : 10;
    const offset = (page - 1) * pageSize;

    const totalItems = await this.orderModel.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / pageSize);

    const result = await this.orderModel
      .find(filter, projection)
      .skip(offset)
      .limit(pageSize)
      .sort((sort as any) || { createdAt: -1 })
      .populate('detail._id')
      .exec();

    return {
      meta: {
        current: page,
        pageSize,
        pages: totalPages,
        total: totalItems,
      },
      result,
    };
  }

  // ---------------- DETAIL ----------------
  async findOne(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid order id: ${id}`);
    }

    return this.orderModel.findById(id).populate('detail._id');
  }

  // ---------------- UPDATE STATUS ----------------
  async updateStatus(id: string, dto: UpdateOrderStatusDto, user: IUser) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid order id');
    }

    const order = await this.orderModel.findById(id);
    if (!order) throw new BadRequestException('Order not found');

    const nextStatus = dto.status;

    // Bảng trạng thái hợp lệ
    const validFlow: Record<string, string[]> = {
      pending: ['shipping', 'canceled'], // admin -> shipping, user -> canceled
      shipping: ['delivered'], // admin báo đã giao
      delivered: ['completed', 'returned-request'], // user chọn
      'returned-request': ['returned-completed'], // admin xử lý hoàn
      completed: [], // cuối
      'returned-completed': [], // cuối
      canceled: [], // cuối
    };

    const current = order.status || 'pending';
    const allowNext = validFlow[current] || [];

    if (!allowNext.includes(nextStatus)) {
      throw new BadRequestException(
        `Không thể chuyển trạng thái từ "${current}" sang "${nextStatus}"`,
      );
    }

    // Khi đơn "Hoàn tất" → chỉ cộng sold, kho đã trừ từ lúc pending rồi
    if (nextStatus === 'completed') {
      for (const item of order.detail) {
        await this.productModel.updateOne(
          { _id: item._id },
          {
            $inc: {
              sold: item.quantity, // chỉ cộng doanh số
            },
          },
        );
      }
    }

    // Nếu đơn hoàn hàng xong → trả lại hàng về kho
    if (nextStatus === 'returned-completed') {
      for (const item of order.detail) {
        await this.productModel.updateOne(
          { _id: item._id },
          {
            $inc: {
              quantity: item.quantity, // trả lại tồn kho
            },
          },
        );
      }
    }


    // Cập nhật trạng thái
    order.status = nextStatus;
    // order.updatedBy = { _id: user._id, email: user.email };
    await order.save();

    return {
      id: order._id,
      status: order.status,
    };
  }

  // ---------------- USER CANCEL ORDER ----------------
  async cancelOrder(id: string, user: IUser) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid order id');
    }

    const order = await this.orderModel.findById(id);
    if (!order) throw new BadRequestException('Order not found');

    if (order.status !== 'pending') {
      throw new BadRequestException(
        'Chỉ được hủy đơn khi đang ở trạng thái "chờ xác nhận" (pending)',
      );
    }

    // Vì đã trừ kho lúc tạo đơn, nên khi hủy phải cộng trả lại
    for (const item of order.detail) {
      await this.productModel.updateOne(
        { _id: item._id },
        {
          $inc: {
            quantity: item.quantity, // trả lại tồn kho
          },
        },
      );
    }

    order.status = 'canceled';
    // order.updatedBy = { _id: user._id, email: user.email };
    await order.save();

    return {
      id: order._id,
      status: order.status,
    };
  }

}
