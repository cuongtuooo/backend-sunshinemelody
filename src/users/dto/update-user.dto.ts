import { IsEmail, IsMongoId, IsNotEmpty, IsOptional } from "class-validator";

export class UpdateUserDto {
    @IsNotEmpty({ message: "_id không được để trống" })
    _id: string;

    @IsOptional()
    @IsEmail({}, { message: "Email không đúng định dạng" })
    email?: string;

    @IsOptional()
    name?: string;

    @IsOptional()
    phone?: string;

    @IsOptional()
    @IsMongoId({ message: "role phải là ObjectId hợp lệ" })
    role?: string;
}
