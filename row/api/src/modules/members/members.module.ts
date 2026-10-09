import { Module } from "@nestjs/common";
import { MembersController } from "./members.controller";
import { MemberService } from "./members.service";

@Module({ controllers: [MembersController], providers: [MemberService], exports: [MemberService] })
export class MembersModule {}
