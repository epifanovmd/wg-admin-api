import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { WgNode } from "../wg-node";
import {
  WG_SOCKS_NAME_MAX,
  WG_SOCKS_SERVER_NAME_MAX,
  WG_SOCKS_USERNAME_MAX,
} from "./wg-socks.types";

/**
 * SOCKS5-прокси через mTLS на ноде: агент принимает TLS только с клиентским
 * сертификатом из allowlist, затем SOCKS5 с логином и паролем. Ключи — зашифрованы `WgSecretBox`.
 */
@Entity("wg_socks_services")
@Index("IDX_WG_SOCKS_NAME", ["name"], { unique: true })
@Index("IDX_WG_SOCKS_NODE_PORT", ["nodeId", "listenPort"], { unique: true })
export class WgSocksService {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: WG_SOCKS_NAME_MAX })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ name: "node_id", type: "uuid" })
  nodeId!: string;

  @ManyToOne(() => WgNode, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "node_id" })
  node?: WgNode;

  /** TCP-порт на ноде. */
  @Column({ name: "listen_port", type: "int" })
  listenPort!: number;

  /**
   * Адрес, по которому подключаются клиенты, если он не совпадает с нодой
   * (прокси доступен через проброс на другой ноде). null — publicHost ноды.
   */
  @Column({
    name: "client_host",
    type: "varchar",
    length: WG_SOCKS_SERVER_NAME_MAX,
    nullable: true,
  })
  clientHost!: string | null;

  /** Порт для клиентов; null — listenPort. */
  @Column({ name: "client_port", type: "int", nullable: true })
  clientPort!: number | null;

  /** CN/SNI серверного сертификата. */
  @Column({
    name: "server_name",
    type: "varchar",
    length: WG_SOCKS_SERVER_NAME_MAX,
  })
  serverName!: string;

  @Column({ name: "ca_cert_pem", type: "text" })
  caCertPem!: string;

  /** Ключ CA (зашифрован): выпуск клиентских сертификатов. */
  @Column({ name: "ca_key_enc", type: "text" })
  caKeyEnc!: string;

  @Column({ name: "server_cert_pem", type: "text" })
  serverCertPem!: string;

  @Column({ name: "server_key_enc", type: "text" })
  serverKeyEnc!: string;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @OneToMany(() => WgSocksUser, user => user.service)
  users?: WgSocksUser[];

  @OneToMany(() => WgSocksClient, client => client.service)
  clients?: WgSocksClient[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}

/** Пользователь SOCKS5 (RFC 1929): агенту — только scrypt-хэш пароля. */
@Entity("wg_socks_users")
@Index("IDX_WG_SOCKS_USERS_NAME", ["serviceId", "username"], { unique: true })
export class WgSocksUser {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "service_id", type: "uuid" })
  serviceId!: string;

  @ManyToOne(() => WgSocksService, service => service.users, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "service_id" })
  service?: WgSocksService;

  @Column({ type: "varchar", length: WG_SOCKS_USERNAME_MAX })
  username!: string;

  /** Пароль, зашифрованный для показа админу (ссылка для Telegram). */
  @Column({ name: "password_enc", type: "text" })
  passwordEnc!: string;

  @Column({ name: "password_salt", type: "varchar", length: 32 })
  passwordSalt!: string;

  @Column({ name: "password_hash", type: "varchar", length: 64 })
  passwordHash!: string;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

/** Клиентский сертификат mTLS; отзыв — исключение из allowlist агента. */
@Entity("wg_socks_clients")
@Index("IDX_WG_SOCKS_CLIENTS_FP", ["serviceId", "fingerprint"], {
  unique: true,
})
export class WgSocksClient {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "service_id", type: "uuid" })
  serviceId!: string;

  @ManyToOne(() => WgSocksService, service => service.clients, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "service_id" })
  service?: WgSocksService;

  @Column({ type: "varchar", length: WG_SOCKS_NAME_MAX })
  name!: string;

  @Column({ name: "cert_pem", type: "text" })
  certPem!: string;

  /** Ключ клиента (зашифрован) — для клиента устройства. */
  @Column({ name: "key_enc", type: "text" })
  keyEnc!: string;

  /** SHA-256 сертификата (hex) — allowlist агента. */
  @Column({ type: "varchar", length: 64 })
  fingerprint!: string;

  @Column({ type: "boolean", default: false })
  revoked!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
