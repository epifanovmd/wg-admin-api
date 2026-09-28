import { asGrantResolver, Module } from "../../core";
import { PermissionController, PermissionRepository } from "../permission";
import { Permission } from "../permission/permission.entity";
import { RoleController, RoleRepository, RoleService } from "../role";
import { Role } from "../role/role.entity";
import { asSocketListener } from "../socket";
import { AdminBootstrap } from "./admin.bootstrap";
import { EmailChangeService } from "./email-change.service";
import { EmailChangeRequest } from "./email-change-request.entity";
import { EmailChangeRequestRepository } from "./email-change-request.repository";
import { SeedBootstrap } from "./seed.bootstrap";
import { UserController } from "./user.controller";
import { User } from "./user.entity";
import { UserListener } from "./user.listener";
import { UserRepository } from "./user.repository";
import { UserService } from "./user.service";
import { UserGrantResolver } from "./user-grant.resolver";

@Module({
  entities: [User, Role, Permission, EmailChangeRequest],
  providers: [
    UserRepository,
    EmailChangeRequestRepository,
    RoleRepository,
    RoleService,
    RoleController,
    PermissionRepository,
    PermissionController,
    EmailChangeService,
    UserController,
    UserService,
    asGrantResolver(UserGrantResolver),
    asSocketListener(UserListener),
  ],
  bootstrappers: [AdminBootstrap, SeedBootstrap],
})
export class UserModule {}
