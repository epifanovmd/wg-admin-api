/* tslint:disable */
/* eslint-disable */
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import type { TsoaRoute } from '@tsoa/runtime';
import { fetchMiddlewares, KoaTemplateService } from '@tsoa/runtime';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { ApiKeyController } from './../modules/api-key/api-key.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { PermissionController } from './../modules/permission/permission.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WgNodeController } from './../modules/wg-node/wg-node.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WgEndpointController } from './../modules/wg-endpoint/wg-endpoint.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WgInterfaceController } from './../modules/wg-interface/wg-interface.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WgPeerController } from './../modules/wg-peer/wg-peer.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WgStatsController } from './../modules/wg-stats/wg-stats.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { RoleController } from './../modules/role/role.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WgSocksController } from './../modules/wg-socks/wg-socks.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WgProvisionController } from './../modules/wg-provision/wg-provision.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WgForwardController } from './../modules/wg-forward/wg-forward.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { JobsController } from './../modules/jobs/jobs.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WgAgentController } from './../modules/wg-agent/wg-agent.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WgAgentUpdateController } from './../modules/wg-agent/wg-agent-update.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { UserController } from './../modules/user/user.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { SessionController } from './../modules/session/session.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { ProfileController } from './../modules/profile/profile.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AuthController } from './../modules/auth/auth.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { PasskeysController } from './../modules/passkeys/passkeys.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AuditController } from './../modules/audit/audit.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AppInfoController } from './../modules/app-info/app-info.controller';
import { koaAuthentication } from './../core/auth/koa-authentication';
// @ts-ignore - no great way to install types from subpackage
import { iocContainer } from './../app.container';
import type { IocContainer, IocContainerFactory } from '@tsoa/runtime';
import type { Context, Next, Middleware, Request as KRequest, Response as KResponse } from 'koa';
import type * as KoaRouter from '@koa/router';
const koaAuthenticationRecasted = koaAuthentication as (req: KRequest, securityName: string, scopes?: string[], res?: KResponse) => Promise<any>;


// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

const models: TsoaRoute.Models = {
    "IErrorResponseDto": {
        "dataType": "refObject",
        "properties": {
            "status": {"dataType":"double","required":true},
            "code": {"dataType":"string","required":true},
            "message": {"dataType":"string","required":true},
            "details": {"dataType":"any"},
            "requestId": {"dataType":"string"},
            "stack": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ApiKeyDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "prefix": {"dataType":"string","required":true},
            "scopes": {"dataType":"array","array":{"dataType":"string"},"required":true},
            "ownerId": {"dataType":"string","required":true},
            "lastUsedAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "expiresAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "revokedAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreatedApiKeyDto": {
        "dataType": "refObject",
        "properties": {
            "apiKey": {"ref":"ApiKeyDto","required":true},
            "key": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreateApiKeyBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true,"validators":{"minLength":{"value":1},"maxLength":{"value":100}}},
            "scopes": {"dataType":"array","array":{"dataType":"string"},"required":true},
            "expiresAt": {"dataType":"datetime"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPaginatedDto_ApiKeyDto_": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"ApiKeyDto"},"required":true},
            "total": {"dataType":"double","required":true},
            "offset": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UUID": {
        "dataType": "refAlias",
        "type": {"dataType":"string","validators":{"pattern":{"errorMsg":"Некорректный UUID","value":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"}}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "TPermission": {
        "dataType": "refAlias",
        "type": {"dataType":"string","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPermissionCatalogItemDto": {
        "dataType": "refObject",
        "properties": {
            "name": {"ref":"TPermission","required":true},
            "label": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPermissionCatalogGroupDto": {
        "dataType": "refObject",
        "properties": {
            "key": {"dataType":"string","required":true},
            "label": {"dataType":"string","required":true},
            "permissions": {"dataType":"array","array":{"dataType":"refObject","ref":"IPermissionCatalogItemDto"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPermissionCatalogDto": {
        "dataType": "refObject",
        "properties": {
            "groups": {"dataType":"array","array":{"dataType":"refObject","ref":"IPermissionCatalogGroupDto"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgNodeStatus": {
        "dataType": "refEnum",
        "enums": ["created","provisioning","online","offline","error"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgMode": {
        "dataType": "refEnum",
        "enums": ["kernel","userspace"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgNodeOsInfo": {
        "dataType": "refObject",
        "properties": {
            "platform": {"dataType":"string"},
            "release": {"dataType":"string"},
            "distro": {"dataType":"string"},
            "arch": {"dataType":"string"},
            "hostname": {"dataType":"string"},
            "kernel": {"dataType":"string"},
            "wgMode": {"ref":"EWgMode"},
            "udpPorts": {"dataType":"array","array":{"dataType":"double"}},
            "tcpPorts": {"dataType":"array","array":{"dataType":"double"}},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgNodeDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "publicHost": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "status": {"ref":"EWgNodeStatus","required":true},
            "hasAgentKey": {"dataType":"boolean","required":true},
            "configVersion": {"dataType":"double","required":true},
            "appliedVersion": {"dataType":"double","required":true},
            "inSync": {"dataType":"boolean","required":true},
            "applyError": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "agentVersion": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "wgVersion": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "agentCodeHash": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "osInfo": {"dataType":"union","subSchemas":[{"ref":"IWgNodeOsInfo"},{"dataType":"enum","enums":[null]}],"required":true},
            "agentRemoteIp": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "lastSeenAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"datetime","required":true},
            "updatedAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreatedWgNodeDto": {
        "dataType": "refObject",
        "properties": {
            "node": {"ref":"WgNodeDto","required":true},
            "agentKey": {"dataType":"string","required":true},
            "installCommand": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreateWgNodeBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "publicHost": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPaginatedDto_WgNodeDto_": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"WgNodeDto"},"required":true},
            "total": {"dataType":"double","required":true},
            "offset": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgNodeOptionDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "status": {"ref":"EWgNodeStatus","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUpdateWgNodeBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string"},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "publicHost": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentKeyDto": {
        "dataType": "refObject",
        "properties": {
            "agentKey": {"dataType":"string","required":true},
            "installCommand": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgNodeLogsDto": {
        "dataType": "refObject",
        "properties": {
            "content": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgEndpointMode": {
        "dataType": "refEnum",
        "enums": ["direct","relay"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgForwardMode": {
        "dataType": "refEnum",
        "enums": ["dnat","ipip"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgEndpointDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "host": {"dataType":"string","required":true},
            "mode": {"ref":"EWgEndpointMode","required":true},
            "relayNodeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "forwardMode": {"ref":"EWgForwardMode","required":true},
            "createdAt": {"dataType":"datetime","required":true},
            "updatedAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreateWgEndpointBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "host": {"dataType":"string","required":true},
            "mode": {"ref":"EWgEndpointMode","required":true},
            "relayNodeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "forwardMode": {"ref":"EWgForwardMode"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPaginatedDto_WgEndpointDto_": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"WgEndpointDto"},"required":true},
            "total": {"dataType":"double","required":true},
            "offset": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgEndpointOptionDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "host": {"dataType":"string","required":true},
            "mode": {"ref":"EWgEndpointMode","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUpdateWgEndpointBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string"},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "host": {"dataType":"string"},
            "mode": {"ref":"EWgEndpointMode"},
            "relayNodeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "forwardMode": {"ref":"EWgForwardMode"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgInterfaceStatus": {
        "dataType": "refEnum",
        "enums": ["up","down","error","unknown"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgInterfaceReplicaDto": {
        "dataType": "refObject",
        "properties": {
            "nodeId": {"dataType":"string","required":true},
            "nodeName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "priority": {"dataType":"double","required":true},
            "status": {"ref":"EWgInterfaceStatus","required":true},
            "statusMessage": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgInterfaceDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "nodeId": {"dataType":"string","required":true},
            "nodeName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "name": {"dataType":"string","required":true},
            "listenPort": {"dataType":"double","required":true},
            "addressCidr": {"dataType":"string","required":true},
            "addressV6Cidr": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "publicKey": {"dataType":"string","required":true},
            "dns": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "mtu": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "endpointId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "endpointPort": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "clientEndpoint": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "natEnabled": {"dataType":"boolean","required":true},
            "customPostUp": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "customPostDown": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "enabled": {"dataType":"boolean","required":true},
            "status": {"ref":"EWgInterfaceStatus","required":true},
            "statusMessage": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "replicas": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgInterfaceReplicaDto"},"required":true},
            "activeReplicaNodeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "servingNodeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"datetime","required":true},
            "updatedAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreateWgInterfaceBody": {
        "dataType": "refObject",
        "properties": {
            "nodeId": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "listenPort": {"dataType":"double","required":true},
            "addressCidr": {"dataType":"string","required":true},
            "addressV6Cidr": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "dns": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "mtu": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}]},
            "endpointId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "endpointPort": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}]},
            "natEnabled": {"dataType":"boolean"},
            "customPostUp": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "customPostDown": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "enabled": {"dataType":"boolean"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPaginatedDto_WgInterfaceDto_": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"WgInterfaceDto"},"required":true},
            "total": {"dataType":"double","required":true},
            "offset": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgInterfaceOptionDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "nodeId": {"dataType":"string","required":true},
            "nodeName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "addressCidr": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUpdateWgInterfaceBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string"},
            "listenPort": {"dataType":"double"},
            "addressCidr": {"dataType":"string"},
            "addressV6Cidr": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "dns": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "mtu": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}]},
            "endpointId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "endpointPort": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}]},
            "natEnabled": {"dataType":"boolean"},
            "customPostUp": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "customPostDown": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "activeReplicaNodeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IMoveWgInterfaceBody": {
        "dataType": "refObject",
        "properties": {
            "nodeId": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IAddWgInterfaceReplicaBody": {
        "dataType": "refObject",
        "properties": {
            "nodeId": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgNodeCommandType": {
        "dataType": "refEnum",
        "enums": ["interface-restart","agent-logs","agent-update"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgNodeCommandStatus": {
        "dataType": "refEnum",
        "enums": ["pending","running","succeeded","failed","timeout"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgNodeCommandPayload": {
        "dataType": "refObject",
        "properties": {
            "interfaceName": {"dataType":"string"},
            "lines": {"dataType":"double"},
            "hash": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgNodeCommandDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "nodeId": {"dataType":"string","required":true},
            "type": {"ref":"EWgNodeCommandType","required":true},
            "status": {"ref":"EWgNodeCommandStatus","required":true},
            "payload": {"ref":"IWgNodeCommandPayload","required":true},
            "output": {"dataType":"string","required":true},
            "exitCode": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "error": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "requestedBy": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "timeoutSec": {"dataType":"double","required":true},
            "startedAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "finishedAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgPeerDisabledReason": {
        "dataType": "refEnum",
        "enums": ["manual","expired"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgPeerDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "interfaceId": {"dataType":"string","required":true},
            "interfaceName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "nodeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "nodeName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "userId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "name": {"dataType":"string","required":true},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "publicKey": {"dataType":"string","required":true},
            "hasPrivateKey": {"dataType":"boolean","required":true},
            "hasPresharedKey": {"dataType":"boolean","required":true},
            "addressV4": {"dataType":"string","required":true},
            "addressV6": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "clientAllowedIPs": {"dataType":"string","required":true},
            "clientDns": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "clientMtu": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "persistentKeepalive": {"dataType":"double","required":true},
            "enabled": {"dataType":"boolean","required":true},
            "disabledReason": {"dataType":"union","subSchemas":[{"ref":"EWgPeerDisabledReason"},{"dataType":"enum","enums":[null]}],"required":true},
            "expiresAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "lastHandshakeAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "lastEndpoint": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "isOnline": {"dataType":"boolean","required":true},
            "rxBytesTotal": {"dataType":"double","required":true},
            "txBytesTotal": {"dataType":"double","required":true},
            "createdAt": {"dataType":"datetime","required":true},
            "updatedAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreateWgPeerBody": {
        "dataType": "refObject",
        "properties": {
            "interfaceId": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "userId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "publicKey": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "withPresharedKey": {"dataType":"boolean"},
            "clientAllowedIPs": {"dataType":"string"},
            "clientDns": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "clientMtu": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}]},
            "persistentKeepalive": {"dataType":"double"},
            "expiresAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}]},
            "enabled": {"dataType":"boolean"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPaginatedDto_WgPeerDto_": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"WgPeerDto"},"required":true},
            "total": {"dataType":"double","required":true},
            "offset": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgPeerOptionDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "interfaceId": {"dataType":"string","required":true},
            "addressV4": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUpdateWgPeerBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string"},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "clientAllowedIPs": {"dataType":"string"},
            "clientDns": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "clientMtu": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}]},
            "persistentKeepalive": {"dataType":"double"},
            "expiresAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}]},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IAssignWgPeerBody": {
        "dataType": "refObject",
        "properties": {
            "userId": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgPeerQrDto": {
        "dataType": "refObject",
        "properties": {
            "dataUrl": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgOverview": {
        "dataType": "refObject",
        "properties": {
            "nodes": {"dataType":"nestedObjectLiteral","nestedProperties":{"online":{"dataType":"double","required":true},"total":{"dataType":"double","required":true}},"required":true},
            "interfaces": {"dataType":"nestedObjectLiteral","nestedProperties":{"enabled":{"dataType":"double","required":true},"total":{"dataType":"double","required":true}},"required":true},
            "peers": {"dataType":"nestedObjectLiteral","nestedProperties":{"online":{"dataType":"double","required":true},"enabled":{"dataType":"double","required":true},"total":{"dataType":"double","required":true}},"required":true},
            "rxTotal": {"dataType":"double","required":true},
            "txTotal": {"dataType":"double","required":true},
            "rxBps": {"dataType":"double","required":true},
            "txBps": {"dataType":"double","required":true},
            "ts": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgSeriesPointDto": {
        "dataType": "refObject",
        "properties": {
            "ts": {"dataType":"datetime","required":true},
            "rxBytes": {"dataType":"double","required":true},
            "txBytes": {"dataType":"double","required":true},
            "rxBps": {"dataType":"double","required":true},
            "txBps": {"dataType":"double","required":true},
            "rxPeakBps": {"dataType":"double","required":true},
            "txPeakBps": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgSeriesDto": {
        "dataType": "refObject",
        "properties": {
            "key": {"dataType":"string","required":true},
            "points": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgSeriesPointDto"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgSeriesGroupBy": {
        "dataType": "refEnum",
        "enums": ["total","node","interface","peer"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgPeerLive": {
        "dataType": "refObject",
        "properties": {
            "peerId": {"dataType":"string","required":true},
            "interfaceId": {"dataType":"string","required":true},
            "nodeId": {"dataType":"string","required":true},
            "userId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "online": {"dataType":"boolean","required":true},
            "lastHandshakeAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "endpoint": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "rxTotal": {"dataType":"double","required":true},
            "txTotal": {"dataType":"double","required":true},
            "rxBps": {"dataType":"double","required":true},
            "txBps": {"dataType":"double","required":true},
            "ts": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgInterfaceLive": {
        "dataType": "refObject",
        "properties": {
            "interfaceId": {"dataType":"string","required":true},
            "nodeId": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "peersTotal": {"dataType":"double","required":true},
            "peersOnline": {"dataType":"double","required":true},
            "rxTotal": {"dataType":"double","required":true},
            "txTotal": {"dataType":"double","required":true},
            "rxBps": {"dataType":"double","required":true},
            "txBps": {"dataType":"double","required":true},
            "ts": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgNicRate": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true},
            "rxBps": {"dataType":"double","required":true},
            "txBps": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgNodeSysMetrics": {
        "dataType": "refObject",
        "properties": {
            "cpuPercent": {"dataType":"double","required":true},
            "load1": {"dataType":"double","required":true},
            "load5": {"dataType":"double"},
            "load15": {"dataType":"double"},
            "nics": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgNicRate"}},
            "conntrackCount": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}]},
            "conntrackMax": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}]},
            "memUsedBytes": {"dataType":"double","required":true},
            "memTotalBytes": {"dataType":"double","required":true},
            "diskUsedBytes": {"dataType":"double","required":true},
            "diskTotalBytes": {"dataType":"double","required":true},
            "uptimeSec": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgAgentTransport": {
        "dataType": "refEnum",
        "enums": ["link","http"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgNodeLive": {
        "dataType": "refObject",
        "properties": {
            "nodeId": {"dataType":"string","required":true},
            "interfacesTotal": {"dataType":"double","required":true},
            "peersTotal": {"dataType":"double","required":true},
            "peersOnline": {"dataType":"double","required":true},
            "rxTotal": {"dataType":"double","required":true},
            "txTotal": {"dataType":"double","required":true},
            "rxBps": {"dataType":"double","required":true},
            "txBps": {"dataType":"double","required":true},
            "sys": {"dataType":"union","subSchemas":[{"ref":"IWgNodeSysMetrics"},{"dataType":"enum","enums":[null]}],"required":true},
            "transport": {"dataType":"union","subSchemas":[{"ref":"EWgAgentTransport"},{"dataType":"enum","enums":[null]}],"required":true},
            "ts": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgSpeedPoint": {
        "dataType": "refObject",
        "properties": {
            "ts": {"dataType":"double","required":true},
            "rxBps": {"dataType":"double","required":true},
            "txBps": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgMeshCell": {
        "dataType": "refObject",
        "properties": {
            "fromNodeId": {"dataType":"string","required":true},
            "toNodeId": {"dataType":"string","required":true},
            "rttMs": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "lossPercent": {"dataType":"double","required":true},
            "ts": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgMeshMatrix": {
        "dataType": "refObject",
        "properties": {
            "nodes": {"dataType":"array","array":{"dataType":"nestedObjectLiteral","nestedProperties":{"name":{"dataType":"string","required":true},"id":{"dataType":"string","required":true}}},"required":true},
            "cells": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgMeshCell"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgLinkRole": {
        "dataType": "refEnum",
        "enums": ["relay","target"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgLinkStatus": {
        "dataType": "refEnum",
        "enums": ["ok","degraded","down","unknown"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgLinkHealth": {
        "dataType": "refObject",
        "properties": {
            "linkId": {"dataType":"string","required":true},
            "role": {"ref":"EWgLinkRole","required":true},
            "counterpartNodeId": {"dataType":"string","required":true},
            "counterpartName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "tunnelName": {"dataType":"string","required":true},
            "rttMs": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "lossPercent": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "status": {"ref":"EWgLinkStatus","required":true},
            "ts": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgNodeMetricPointDto": {
        "dataType": "refObject",
        "properties": {
            "ts": {"dataType":"datetime","required":true},
            "cpuPercent": {"dataType":"double","required":true},
            "load1": {"dataType":"double","required":true},
            "memUsedBytes": {"dataType":"double","required":true},
            "memTotalBytes": {"dataType":"double","required":true},
            "diskUsedBytes": {"dataType":"double","required":true},
            "diskTotalBytes": {"dataType":"double","required":true},
            "uptimeSec": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "KnownRole": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["admin"]},{"dataType":"enum","enums":["user"]},{"dataType":"enum","enums":["guest"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "TRole": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"KnownRole"},{"dataType":"intersection","subSchemas":[{"dataType":"string"},{"dataType":"nestedObjectLiteral","nestedProperties":{}}]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPermissionDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"ref":"TPermission","required":true},
            "createdAt": {"dataType":"datetime","required":true},
            "updatedAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IRoleDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"ref":"TRole","required":true},
            "createdAt": {"dataType":"datetime","required":true},
            "updatedAt": {"dataType":"datetime","required":true},
            "permissions": {"dataType":"array","array":{"dataType":"refObject","ref":"IPermissionDto"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "RoleName": {
        "dataType": "refAlias",
        "type": {"dataType":"string","validators":{"minLength":{"value":1},"maxLength":{"value":100}}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreateRoleRequestDto": {
        "dataType": "refObject",
        "properties": {
            "name": {"ref":"RoleName","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PermissionName": {
        "dataType": "refAlias",
        "type": {"dataType":"string","validators":{"minLength":{"value":1},"maxLength":{"value":100}}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IRolePermissionsRequestDto": {
        "dataType": "refObject",
        "properties": {
            "permissions": {"dataType":"array","array":{"dataType":"refAlias","ref":"PermissionName"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgSocksUserDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "username": {"dataType":"string","required":true},
            "enabled": {"dataType":"boolean","required":true},
            "createdAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgSocksClientDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "fingerprint": {"dataType":"string","required":true},
            "revoked": {"dataType":"boolean","required":true},
            "createdAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgSocksLive": {
        "dataType": "refObject",
        "properties": {
            "connections": {"dataType":"double","required":true},
            "rxBytes": {"dataType":"double","required":true},
            "txBytes": {"dataType":"double","required":true},
            "ts": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgSocksServiceDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "nodeId": {"dataType":"string","required":true},
            "nodeName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "nodeHost": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "listenPort": {"dataType":"double","required":true},
            "clientHost": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "clientPort": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "serverName": {"dataType":"string","required":true},
            "enabled": {"dataType":"boolean","required":true},
            "users": {"dataType":"array","array":{"dataType":"refObject","ref":"WgSocksUserDto"},"required":true},
            "clients": {"dataType":"array","array":{"dataType":"refObject","ref":"WgSocksClientDto"},"required":true},
            "live": {"dataType":"union","subSchemas":[{"ref":"IWgSocksLive"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"datetime","required":true},
            "updatedAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreateWgSocksBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "nodeId": {"dataType":"string","required":true},
            "listenPort": {"dataType":"double","required":true},
            "clientHost": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "clientPort": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}]},
            "serverName": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUpdateWgSocksBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string"},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "listenPort": {"dataType":"double"},
            "clientHost": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "clientPort": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}]},
            "enabled": {"dataType":"boolean"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgSocksUserSecretDto": {
        "dataType": "refObject",
        "properties": {
            "username": {"dataType":"string","required":true},
            "password": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreateWgSocksUserBody": {
        "dataType": "refObject",
        "properties": {
            "username": {"dataType":"string","required":true},
            "password": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUpdateWgSocksUserBody": {
        "dataType": "refObject",
        "properties": {
            "enabled": {"dataType":"boolean"},
            "password": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreateWgSocksClientBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgProvisionStartedDto": {
        "dataType": "refObject",
        "properties": {
            "jobId": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IProvisionWgNodeBody": {
        "dataType": "refObject",
        "properties": {
            "host": {"dataType":"string","required":true},
            "port": {"dataType":"double"},
            "username": {"dataType":"string"},
            "privateKey": {"dataType":"string"},
            "password": {"dataType":"string"},
            "backendUrl": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUninstallWgNodeBody": {
        "dataType": "refObject",
        "properties": {
            "host": {"dataType":"string","required":true},
            "port": {"dataType":"double"},
            "username": {"dataType":"string"},
            "privateKey": {"dataType":"string"},
            "password": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgForwardProtocol": {
        "dataType": "refEnum",
        "enums": ["udp","tcp"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgForwardPath": {
        "dataType": "refEnum",
        "enums": ["direct","ipip"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgForwardRoute": {
        "dataType": "refEnum",
        "enums": ["auto","tunnel","direct"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EWgForwardActiveRoute": {
        "dataType": "refEnum",
        "enums": ["tunnel","direct"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WgForwardDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "relayNodeId": {"dataType":"string","required":true},
            "relayNodeName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "protocol": {"ref":"EWgForwardProtocol","required":true},
            "listenPort": {"dataType":"double","required":true},
            "targetNodeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "targetNodeName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "targetHost": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "targetPort": {"dataType":"double","required":true},
            "path": {"ref":"EWgForwardPath","required":true},
            "route": {"ref":"EWgForwardRoute","required":true},
            "enabled": {"dataType":"boolean","required":true},
            "activeRoute": {"dataType":"union","subSchemas":[{"ref":"EWgForwardActiveRoute"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"datetime","required":true},
            "updatedAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICreateWgForwardBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "relayNodeId": {"dataType":"string","required":true},
            "protocol": {"ref":"EWgForwardProtocol","required":true},
            "listenPort": {"dataType":"double","required":true},
            "targetNodeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "targetHost": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "targetPort": {"dataType":"double","required":true},
            "path": {"ref":"EWgForwardPath","required":true},
            "route": {"ref":"EWgForwardRoute"},
            "enabled": {"dataType":"boolean"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPaginatedDto_WgForwardDto_": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"WgForwardDto"},"required":true},
            "total": {"dataType":"double","required":true},
            "offset": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUpdateWgForwardBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string"},
            "description": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "listenPort": {"dataType":"double"},
            "targetNodeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "targetHost": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "targetPort": {"dataType":"double"},
            "path": {"ref":"EWgForwardPath"},
            "route": {"ref":"EWgForwardRoute"},
            "enabled": {"dataType":"boolean"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EJobRunStatus": {
        "dataType": "refEnum",
        "enums": ["queued","running","completed","failed","cancelled"],
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IJobRunError": {
        "dataType": "refObject",
        "properties": {
            "code": {"dataType":"string","required":true},
            "message": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "JobRunDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "queue": {"dataType":"string","required":true},
            "status": {"ref":"EJobRunStatus","required":true},
            "title": {"dataType":"string","required":true},
            "progress": {"dataType":"double","required":true},
            "progressText": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "logTail": {"dataType":"array","array":{"dataType":"string"},"required":true},
            "result": {"dataType":"any","required":true},
            "error": {"dataType":"union","subSchemas":[{"ref":"IJobRunError"},{"dataType":"enum","enums":[null]}],"required":true},
            "ownerId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "scopeType": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "scopeId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "attempt": {"dataType":"double","required":true},
            "cancelRequested": {"dataType":"boolean","required":true},
            "startedAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "finishedAt": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPaginatedDto_JobRunDto_": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"JobRunDto"},"required":true},
            "total": {"dataType":"double","required":true},
            "offset": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentPeer": {
        "dataType": "refObject",
        "properties": {
            "publicKey": {"dataType":"string","required":true},
            "presharedKey": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "allowedIps": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentInterface": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true},
            "enabled": {"dataType":"boolean","required":true},
            "listenPort": {"dataType":"double","required":true},
            "addressCidr": {"dataType":"string","required":true},
            "addressV6Cidr": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "privateKey": {"dataType":"string","required":true},
            "mtu": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "natEnabled": {"dataType":"boolean","required":true},
            "customPostUp": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "customPostDown": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "peers": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgAgentPeer"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentTunnel": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true},
            "remoteHost": {"dataType":"string","required":true},
            "localTunnelIp": {"dataType":"string","required":true},
            "remoteTunnelIp": {"dataType":"string","required":true},
            "prefix": {"dataType":"double","required":true},
            "mtu": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentForward": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string"},
            "proto": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["udp"]},{"dataType":"enum","enums":["tcp"]}],"required":true},
            "listenPort": {"dataType":"double","required":true},
            "targetIp": {"dataType":"string","required":true},
            "targetPort": {"dataType":"double","required":true},
            "fallbackIp": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "route": {"ref":"EWgForwardRoute"},
            "tunnel": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "candidates": {"dataType":"array","array":{"dataType":"nestedObjectLiteral","nestedProperties":{"nodeId":{"dataType":"string","required":true},"tunnel":{"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},"targetIp":{"dataType":"string","required":true}}}},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgProbeTarget": {
        "dataType": "refObject",
        "properties": {
            "nodeId": {"dataType":"string","required":true},
            "host": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgSocksAgentConfig": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "listenPort": {"dataType":"double","required":true},
            "certPem": {"dataType":"string","required":true},
            "keyPem": {"dataType":"string","required":true},
            "caPem": {"dataType":"string","required":true},
            "allowedFingerprints": {"dataType":"array","array":{"dataType":"string"},"required":true},
            "users": {"dataType":"array","array":{"dataType":"nestedObjectLiteral","nestedProperties":{"hash":{"dataType":"string","required":true},"salt":{"dataType":"string","required":true},"username":{"dataType":"string","required":true}}},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentCommand": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "type": {"ref":"EWgNodeCommandType","required":true},
            "payload": {"ref":"IWgNodeCommandPayload","required":true},
            "timeoutSec": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentDesiredState": {
        "dataType": "refObject",
        "properties": {
            "version": {"dataType":"double","required":true},
            "nodeId": {"dataType":"string","required":true},
            "nodeName": {"dataType":"string","required":true},
            "interfaces": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgAgentInterface"},"required":true},
            "tunnels": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgAgentTunnel"},"required":true},
            "forwards": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgAgentForward"},"required":true},
            "probeTargets": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgProbeTarget"},"required":true},
            "socks": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgSocksAgentConfig"},"required":true},
            "commands": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgAgentCommand"},"required":true},
            "settings": {"dataType":"nestedObjectLiteral","nestedProperties":{"statsIntervalMs":{"dataType":"double","required":true}},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentInterfaceStatusReport": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true},
            "status": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["up"]},{"dataType":"enum","enums":["down"]},{"dataType":"enum","enums":["error"]},{"dataType":"enum","enums":["unknown"]}],"required":true},
            "message": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentReportBody": {
        "dataType": "refObject",
        "properties": {
            "appliedVersion": {"dataType":"double"},
            "applyError": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "agentVersion": {"dataType":"string"},
            "wgVersion": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "codeHash": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "os": {"dataType":"nestedObjectLiteral","nestedProperties":{"tcpPorts":{"dataType":"array","array":{"dataType":"double"}},"udpPorts":{"dataType":"array","array":{"dataType":"double"}},"wgMode":{"ref":"EWgMode"},"kernel":{"dataType":"string"},"hostname":{"dataType":"string"},"arch":{"dataType":"string"},"distro":{"dataType":"string"},"release":{"dataType":"string"},"platform":{"dataType":"string"}}},
            "interfaces": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgAgentInterfaceStatusReport"}},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgTunnelProbe": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true},
            "rttMs": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "lossPercent": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgNodeProbe": {
        "dataType": "refObject",
        "properties": {
            "nodeId": {"dataType":"string","required":true},
            "rttMs": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "lossPercent": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentStatsBody": {
        "dataType": "refObject",
        "properties": {
            "seq": {"dataType":"double"},
            "bootId": {"dataType":"string"},
            "collectedAt": {"dataType":"double"},
            "sentAt": {"dataType":"double"},
            "sys": {"ref":"IWgNodeSysMetrics"},
            "tunnels": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgTunnelProbe"}},
            "forwards": {"dataType":"array","array":{"dataType":"nestedObjectLiteral","nestedProperties":{"activeNodeId":{"dataType":"string"},"activeRoute":{"ref":"EWgForwardActiveRoute","required":true},"id":{"dataType":"string","required":true}}}},
            "socks": {"dataType":"array","array":{"dataType":"nestedObjectLiteral","nestedProperties":{"txBytes":{"dataType":"double","required":true},"rxBytes":{"dataType":"double","required":true},"connections":{"dataType":"double","required":true},"id":{"dataType":"string","required":true}}}},
            "nodeProbes": {"dataType":"array","array":{"dataType":"refObject","ref":"IWgNodeProbe"}},
            "interfaces": {"dataType":"array","array":{"dataType":"nestedObjectLiteral","nestedProperties":{"peers":{"dataType":"array","array":{"dataType":"nestedObjectLiteral","nestedProperties":{"endpoint":{"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},"lastHandshake":{"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},"txBytes":{"dataType":"double","required":true},"rxBytes":{"dataType":"double","required":true},"publicKey":{"dataType":"string","required":true}}},"required":true},"name":{"dataType":"string","required":true}}},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentCommandOutputBody": {
        "dataType": "refObject",
        "properties": {
            "chunk": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentCommandCompleteBody": {
        "dataType": "refObject",
        "properties": {
            "exitCode": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}]},
            "error": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IWgAgentReleaseInfo": {
        "dataType": "refObject",
        "properties": {
            "version": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "hashes": {"dataType":"nestedObjectLiteral","nestedProperties":{"arm64":{"dataType":"string"},"amd64":{"dataType":"string"}},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UserDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "email": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "emailVerified": {"dataType":"boolean"},
            "phone": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "username": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "profile": {"ref":"ProfileDto"},
            "roles": {"dataType":"array","array":{"dataType":"refObject","ref":"IRoleDto"},"required":true},
            "directPermissions": {"dataType":"array","array":{"dataType":"refObject","ref":"IPermissionDto"},"required":true},
            "createdAt": {"dataType":"datetime","required":true},
            "updatedAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ProfileDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "userId": {"dataType":"string","required":true},
            "firstName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "lastName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "birthDate": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "gender": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "locale": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"datetime","required":true},
            "updatedAt": {"dataType":"datetime","required":true},
            "user": {"ref":"UserDto"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserUpdateRequestDto": {
        "dataType": "refObject",
        "properties": {
            "email": {"dataType":"string"},
            "phone": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserConfirmEmailChangeDto": {
        "dataType": "refObject",
        "properties": {
            "code": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserDeleteDto": {
        "dataType": "refObject",
        "properties": {
            "password": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserAdminListDto": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"UserDto"},"required":true},
            "total": {"dataType":"double","required":true},
            "offset": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserOptionDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserOptionsDto": {
        "dataType": "refObject",
        "properties": {
            "data": {"dataType":"array","array":{"dataType":"refObject","ref":"IUserOptionDto"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserPrivilegesRequestDto": {
        "dataType": "refObject",
        "properties": {
            "roles": {"dataType":"array","array":{"dataType":"refAlias","ref":"RoleName"},"required":true},
            "permissions": {"dataType":"array","array":{"dataType":"refAlias","ref":"PermissionName"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserVerifyEmailDto": {
        "dataType": "refObject",
        "properties": {
            "code": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserChangePasswordDto": {
        "dataType": "refObject",
        "properties": {
            "currentPassword": {"dataType":"string","required":true},
            "newPassword": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "SessionDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "userId": {"dataType":"string","required":true},
            "deviceName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "deviceType": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "ip": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "userAgent": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "lastActiveAt": {"dataType":"datetime","required":true},
            "expiresAt": {"dataType":"datetime","required":true},
            "createdAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPaginatedDto_SessionDto_": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"SessionDto"},"required":true},
            "total": {"dataType":"double","required":true},
            "offset": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IProfileUpdateRequestDto": {
        "dataType": "refObject",
        "properties": {
            "firstName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"validators":{"maxLength":{"value":40}}},
            "lastName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"validators":{"maxLength":{"value":40}}},
            "birthDate": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}]},
            "gender": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"validators":{"maxLength":{"value":20}}},
            "locale": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"validators":{"maxLength":{"value":10}}},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PublicProfileDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "userId": {"dataType":"string","required":true},
            "firstName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "lastName": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IProfileListDto": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"PublicProfileDto"},"required":true},
            "total": {"dataType":"double","required":true},
            "offset": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ITokensDto": {
        "dataType": "refObject",
        "properties": {
            "accessToken": {"dataType":"string","required":true},
            "refreshToken": {"dataType":"string","required":true},
            "expiresIn": {"dataType":"double","required":true},
            "sessionId": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserWithTokensDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "email": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "emailVerified": {"dataType":"boolean"},
            "phone": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "username": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "profile": {"ref":"ProfileDto"},
            "roles": {"dataType":"array","array":{"dataType":"refObject","ref":"IRoleDto"},"required":true},
            "directPermissions": {"dataType":"array","array":{"dataType":"refObject","ref":"IPermissionDto"},"required":true},
            "createdAt": {"dataType":"datetime","required":true},
            "updatedAt": {"dataType":"datetime","required":true},
            "tokens": {"ref":"ITokensDto","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "TSignUpRequestDto": {
        "dataType": "refAlias",
        "type": {"dataType":"intersection","subSchemas":[{"dataType":"nestedObjectLiteral","nestedProperties":{"password":{"dataType":"string","required":true},"lastName":{"dataType":"string"},"firstName":{"dataType":"string"}}},{"dataType":"union","subSchemas":[{"dataType":"nestedObjectLiteral","nestedProperties":{"phone":{"dataType":"string","required":true},"email":{"dataType":"string"}}},{"dataType":"nestedObjectLiteral","nestedProperties":{"phone":{"dataType":"string"},"email":{"dataType":"string","required":true}}}]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "I2FARequiredDto": {
        "dataType": "refObject",
        "properties": {
            "require2FA": {"dataType":"enum","enums":[true],"required":true},
            "twoFactorToken": {"dataType":"string","required":true},
            "twoFactorHint": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ISignInResponseDto": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"IUserWithTokensDto"},{"ref":"I2FARequiredDto"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ISignInRequestDto": {
        "dataType": "refObject",
        "properties": {
            "login": {"dataType":"string","required":true},
            "password": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ApiResponseDto": {
        "dataType": "refObject",
        "properties": {
            "message": {"dataType":"string"},
            "data": {"dataType":"any"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserLoginRequestDto": {
        "dataType": "refObject",
        "properties": {
            "login": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IUserResetPasswordRequestDto": {
        "dataType": "refObject",
        "properties": {
            "token": {"dataType":"string","required":true},
            "password": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IRefreshRequestDto": {
        "dataType": "refObject",
        "properties": {
            "refreshToken": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IEnable2FARequestDto": {
        "dataType": "refObject",
        "properties": {
            "currentPassword": {"dataType":"string","required":true},
            "password": {"dataType":"string","required":true},
            "hint": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IDisable2FARequestDto": {
        "dataType": "refObject",
        "properties": {
            "currentPassword": {"dataType":"string","required":true},
            "password": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IVerify2FARequestDto": {
        "dataType": "refObject",
        "properties": {
            "twoFactorToken": {"dataType":"string","required":true},
            "password": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PasskeyDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "deviceType": {"dataType":"string","required":true},
            "transports": {"dataType":"union","subSchemas":[{"dataType":"array","array":{"dataType":"string"}},{"dataType":"enum","enums":[null]}],"required":true},
            "lastUsed": {"dataType":"union","subSchemas":[{"dataType":"datetime"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IPaginatedDto_PasskeyDto_": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"PasskeyDto"},"required":true},
            "total": {"dataType":"double","required":true},
            "offset": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PublicKeyCredentialRpEntity": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string","required":true},
            "id": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PublicKeyCredentialUserEntityJSON": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "displayName": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Base64URLString": {
        "dataType": "refAlias",
        "type": {"dataType":"string","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "COSEAlgorithmIdentifier": {
        "dataType": "refAlias",
        "type": {"dataType":"double","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PublicKeyCredentialType": {
        "dataType": "refAlias",
        "type": {"dataType":"enum","enums":["public-key"],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PublicKeyCredentialParameters": {
        "dataType": "refObject",
        "properties": {
            "alg": {"ref":"COSEAlgorithmIdentifier","required":true},
            "type": {"ref":"PublicKeyCredentialType","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PublicKeyCredentialDescriptorJSON": {
        "dataType": "refObject",
        "properties": {
            "id": {"ref":"Base64URLString","required":true},
            "type": {"dataType":"string","required":true},
            "transports": {"dataType":"array","array":{"dataType":"string"}},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthenticatorAttachment": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["cross-platform"]},{"dataType":"enum","enums":["platform"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ResidentKeyRequirement": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["discouraged"]},{"dataType":"enum","enums":["preferred"]},{"dataType":"enum","enums":["required"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UserVerificationRequirement": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["discouraged"]},{"dataType":"enum","enums":["preferred"]},{"dataType":"enum","enums":["required"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthenticatorSelectionCriteria": {
        "dataType": "refObject",
        "properties": {
            "authenticatorAttachment": {"ref":"AuthenticatorAttachment"},
            "requireResidentKey": {"dataType":"boolean"},
            "residentKey": {"ref":"ResidentKeyRequirement"},
            "userVerification": {"ref":"UserVerificationRequirement"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AttestationConveyancePreference": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["direct"]},{"dataType":"enum","enums":["enterprise"]},{"dataType":"enum","enums":["indirect"]},{"dataType":"enum","enums":["none"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthenticationExtensionsClientInputs": {
        "dataType": "refObject",
        "properties": {
            "appid": {"dataType":"string"},
            "credProps": {"dataType":"boolean"},
            "hmacCreateSecret": {"dataType":"boolean"},
            "minPinLength": {"dataType":"boolean"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PublicKeyCredentialCreationOptionsJSON": {
        "dataType": "refObject",
        "properties": {
            "rp": {"ref":"PublicKeyCredentialRpEntity","required":true},
            "user": {"ref":"PublicKeyCredentialUserEntityJSON","required":true},
            "challenge": {"ref":"Base64URLString","required":true},
            "pubKeyCredParams": {"dataType":"array","array":{"dataType":"refObject","ref":"PublicKeyCredentialParameters"},"required":true},
            "timeout": {"dataType":"double"},
            "excludeCredentials": {"dataType":"array","array":{"dataType":"refObject","ref":"PublicKeyCredentialDescriptorJSON"}},
            "authenticatorSelection": {"ref":"AuthenticatorSelectionCriteria"},
            "hints": {"dataType":"array","array":{"dataType":"string"}},
            "attestation": {"ref":"AttestationConveyancePreference"},
            "attestationFormats": {"dataType":"array","array":{"dataType":"string"}},
            "extensions": {"ref":"AuthenticationExtensionsClientInputs"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IVerifyRegistrationResponseDto": {
        "dataType": "refObject",
        "properties": {
            "verified": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthenticatorTransportFuture": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["ble"]},{"dataType":"enum","enums":["cable"]},{"dataType":"enum","enums":["hybrid"]},{"dataType":"enum","enums":["internal"]},{"dataType":"enum","enums":["nfc"]},{"dataType":"enum","enums":["smart-card"]},{"dataType":"enum","enums":["usb"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthenticatorAttestationResponseJSON": {
        "dataType": "refObject",
        "properties": {
            "clientDataJSON": {"ref":"Base64URLString","required":true},
            "attestationObject": {"ref":"Base64URLString","required":true},
            "authenticatorData": {"ref":"Base64URLString"},
            "transports": {"dataType":"array","array":{"dataType":"refAlias","ref":"AuthenticatorTransportFuture"}},
            "publicKeyAlgorithm": {"ref":"COSEAlgorithmIdentifier"},
            "publicKey": {"ref":"Base64URLString"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CredentialPropertiesOutput": {
        "dataType": "refObject",
        "properties": {
            "rk": {"dataType":"boolean"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthenticationExtensionsClientOutputs": {
        "dataType": "refObject",
        "properties": {
            "appid": {"dataType":"boolean"},
            "credProps": {"ref":"CredentialPropertiesOutput"},
            "hmacCreateSecret": {"dataType":"boolean"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "RegistrationResponseJSON": {
        "dataType": "refObject",
        "properties": {
            "id": {"ref":"Base64URLString","required":true},
            "rawId": {"ref":"Base64URLString","required":true},
            "response": {"ref":"AuthenticatorAttestationResponseJSON","required":true},
            "authenticatorAttachment": {"ref":"AuthenticatorAttachment"},
            "clientExtensionResults": {"ref":"AuthenticationExtensionsClientOutputs","required":true},
            "type": {"ref":"PublicKeyCredentialType","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IVerifyRegistrationRequestDto": {
        "dataType": "refObject",
        "properties": {
            "data": {"ref":"RegistrationResponseJSON","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PublicKeyCredentialRequestOptionsJSON": {
        "dataType": "refObject",
        "properties": {
            "challenge": {"ref":"Base64URLString","required":true},
            "timeout": {"dataType":"double"},
            "rpId": {"dataType":"string"},
            "allowCredentials": {"dataType":"array","array":{"dataType":"refObject","ref":"PublicKeyCredentialDescriptorJSON"}},
            "userVerification": {"ref":"UserVerificationRequirement"},
            "hints": {"dataType":"array","array":{"dataType":"string"}},
            "extensions": {"ref":"AuthenticationExtensionsClientInputs"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IGenerateAuthenticationOptionsRequestDto": {
        "dataType": "refObject",
        "properties": {
            "login": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IVerifyAuthenticationResponseDto": {
        "dataType": "refObject",
        "properties": {
            "verified": {"dataType":"boolean","required":true},
            "tokens": {"ref":"ITokensDto"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthenticatorAssertionResponseJSON": {
        "dataType": "refObject",
        "properties": {
            "clientDataJSON": {"ref":"Base64URLString","required":true},
            "authenticatorData": {"ref":"Base64URLString","required":true},
            "signature": {"ref":"Base64URLString","required":true},
            "userHandle": {"ref":"Base64URLString"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthenticationResponseJSON": {
        "dataType": "refObject",
        "properties": {
            "id": {"ref":"Base64URLString","required":true},
            "rawId": {"ref":"Base64URLString","required":true},
            "response": {"ref":"AuthenticatorAssertionResponseJSON","required":true},
            "authenticatorAttachment": {"ref":"AuthenticatorAttachment"},
            "clientExtensionResults": {"ref":"AuthenticationExtensionsClientOutputs","required":true},
            "type": {"ref":"PublicKeyCredentialType","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IVerifyAuthenticationRequestDto": {
        "dataType": "refObject",
        "properties": {
            "data": {"ref":"AuthenticationResponseJSON","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Record_string.unknown_": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{},"additionalProperties":{"dataType":"any"},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuditEventDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "type": {"dataType":"string","required":true},
            "actorId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "subjectId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "ip": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "userAgent": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "meta": {"ref":"Record_string.unknown_","required":true},
            "createdAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ICursorPageDto_AuditEventDto_": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"AuditEventDto"},"required":true},
            "nextCursor": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IAppVersionDto": {
        "dataType": "refObject",
        "properties": {
            "version": {"dataType":"string","required":true},
            "commit": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "builtAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "startedAt": {"dataType":"string","required":true},
            "agentVersion": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
};
const templateService = new KoaTemplateService(models, {"noImplicitAdditionalProperties":"silently-remove-extras","bodyCoercion":true});

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa


export function RegisterRoutes(router: KoaRouter) {

    // ###########################################################################################################
    //  NOTE: If you do not see routes for all of your controllers in this file, then you might not have informed tsoa of where to look
    //      Please look into the "controllerPathGlobs" config option described in the readme: https://github.com/lukeautry/tsoa
    // ###########################################################################################################


        const argsApiKeyController_createApiKey: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"ICreateApiKeyBody"},
        };
        router.post('/api/v1/api-keys',
            authenticateMiddleware([{"jwt":["permission:apikey:create"]}]),
            ...(fetchMiddlewares<Middleware>(ApiKeyController)),
            ...(fetchMiddlewares<Middleware>(ApiKeyController.prototype.createApiKey)),

            async function ApiKeyController_createApiKey(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsApiKeyController_createApiKey, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<ApiKeyController>(ApiKeyController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'createApiKey',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsApiKeyController_listApiKeys: Record<string, TsoaRoute.ParameterSchema> = {
                offset: {"in":"query","name":"offset","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        router.get('/api/v1/api-keys',
            authenticateMiddleware([{"jwt":["permission:apikey:view"]}]),
            ...(fetchMiddlewares<Middleware>(ApiKeyController)),
            ...(fetchMiddlewares<Middleware>(ApiKeyController.prototype.listApiKeys)),

            async function ApiKeyController_listApiKeys(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsApiKeyController_listApiKeys, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<ApiKeyController>(ApiKeyController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'listApiKeys',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsApiKeyController_revokeApiKey: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.post('/api/v1/api-keys/:id/revoke',
            authenticateMiddleware([{"jwt":["permission:apikey:revoke"]}]),
            ...(fetchMiddlewares<Middleware>(ApiKeyController)),
            ...(fetchMiddlewares<Middleware>(ApiKeyController.prototype.revokeApiKey)),

            async function ApiKeyController_revokeApiKey(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsApiKeyController_revokeApiKey, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<ApiKeyController>(ApiKeyController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'revokeApiKey',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPermissionController_getPermissionCatalog: Record<string, TsoaRoute.ParameterSchema> = {
        };
        router.get('/api/v1/permissions',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(PermissionController)),
            ...(fetchMiddlewares<Middleware>(PermissionController.prototype.getPermissionCatalog)),

            async function PermissionController_getPermissionCatalog(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsPermissionController_getPermissionCatalog, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<PermissionController>(PermissionController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getPermissionCatalog',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgNodeController_createWgNode: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"ICreateWgNodeBody"},
        };
        router.post('/api/v1/wg/nodes',
            authenticateMiddleware([{"jwt":["permission:wg:node:create"]}]),
            ...(fetchMiddlewares<Middleware>(WgNodeController)),
            ...(fetchMiddlewares<Middleware>(WgNodeController.prototype.createWgNode)),

            async function WgNodeController_createWgNode(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgNodeController_createWgNode, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgNodeController>(WgNodeController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'createWgNode',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgNodeController_listWgNodes: Record<string, TsoaRoute.ParameterSchema> = {
                query: {"in":"query","name":"query","dataType":"string"},
                status: {"in":"query","name":"status","ref":"EWgNodeStatus"},
                offset: {"in":"query","name":"offset","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        router.get('/api/v1/wg/nodes',
            authenticateMiddleware([{"jwt":["permission:wg:node:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgNodeController)),
            ...(fetchMiddlewares<Middleware>(WgNodeController.prototype.listWgNodes)),

            async function WgNodeController_listWgNodes(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgNodeController_listWgNodes, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgNodeController>(WgNodeController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'listWgNodes',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgNodeController_wgNodeOptions: Record<string, TsoaRoute.ParameterSchema> = {
        };
        router.get('/api/v1/wg/nodes/options',
            authenticateMiddleware([{"jwt":["permission:wg:node:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgNodeController)),
            ...(fetchMiddlewares<Middleware>(WgNodeController.prototype.wgNodeOptions)),

            async function WgNodeController_wgNodeOptions(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgNodeController_wgNodeOptions, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgNodeController>(WgNodeController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgNodeOptions',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgNodeController_getWgNode: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/nodes/:id',
            authenticateMiddleware([{"jwt":["permission:wg:node:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgNodeController)),
            ...(fetchMiddlewares<Middleware>(WgNodeController.prototype.getWgNode)),

            async function WgNodeController_getWgNode(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgNodeController_getWgNode, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgNodeController>(WgNodeController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getWgNode',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgNodeController_updateWgNode: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IUpdateWgNodeBody"},
        };
        router.patch('/api/v1/wg/nodes/:id',
            authenticateMiddleware([{"jwt":["permission:wg:node:update"]}]),
            ...(fetchMiddlewares<Middleware>(WgNodeController)),
            ...(fetchMiddlewares<Middleware>(WgNodeController.prototype.updateWgNode)),

            async function WgNodeController_updateWgNode(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgNodeController_updateWgNode, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgNodeController>(WgNodeController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateWgNode',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgNodeController_deleteWgNode: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/wg/nodes/:id',
            authenticateMiddleware([{"jwt":["permission:wg:node:delete"]}]),
            ...(fetchMiddlewares<Middleware>(WgNodeController)),
            ...(fetchMiddlewares<Middleware>(WgNodeController.prototype.deleteWgNode)),

            async function WgNodeController_deleteWgNode(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgNodeController_deleteWgNode, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgNodeController>(WgNodeController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deleteWgNode',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgNodeController_rotateWgAgentKey: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/wg/nodes/:id/agent-key',
            authenticateMiddleware([{"jwt":["permission:wg:node:agent"]}]),
            ...(fetchMiddlewares<Middleware>(WgNodeController)),
            ...(fetchMiddlewares<Middleware>(WgNodeController.prototype.rotateWgAgentKey)),

            async function WgNodeController_rotateWgAgentKey(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgNodeController_rotateWgAgentKey, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgNodeController>(WgNodeController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'rotateWgAgentKey',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgNodeController_wgNodeLogs: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                lines: {"in":"query","name":"lines","dataType":"double"},
        };
        router.get('/api/v1/wg/nodes/:id/logs',
            authenticateMiddleware([{"jwt":["permission:wg:node:logs"]}]),
            ...(fetchMiddlewares<Middleware>(WgNodeController)),
            ...(fetchMiddlewares<Middleware>(WgNodeController.prototype.wgNodeLogs)),

            async function WgNodeController_wgNodeLogs(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgNodeController_wgNodeLogs, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgNodeController>(WgNodeController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgNodeLogs',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgEndpointController_createWgEndpoint: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"ICreateWgEndpointBody"},
        };
        router.post('/api/v1/wg/endpoints',
            authenticateMiddleware([{"jwt":["permission:wg:endpoint:create"]}]),
            ...(fetchMiddlewares<Middleware>(WgEndpointController)),
            ...(fetchMiddlewares<Middleware>(WgEndpointController.prototype.createWgEndpoint)),

            async function WgEndpointController_createWgEndpoint(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgEndpointController_createWgEndpoint, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgEndpointController>(WgEndpointController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'createWgEndpoint',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgEndpointController_listWgEndpoints: Record<string, TsoaRoute.ParameterSchema> = {
                query: {"in":"query","name":"query","dataType":"string"},
                offset: {"in":"query","name":"offset","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        router.get('/api/v1/wg/endpoints',
            authenticateMiddleware([{"jwt":["permission:wg:endpoint:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgEndpointController)),
            ...(fetchMiddlewares<Middleware>(WgEndpointController.prototype.listWgEndpoints)),

            async function WgEndpointController_listWgEndpoints(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgEndpointController_listWgEndpoints, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgEndpointController>(WgEndpointController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'listWgEndpoints',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgEndpointController_wgEndpointOptions: Record<string, TsoaRoute.ParameterSchema> = {
        };
        router.get('/api/v1/wg/endpoints/options',
            authenticateMiddleware([{"jwt":["permission:wg:endpoint:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgEndpointController)),
            ...(fetchMiddlewares<Middleware>(WgEndpointController.prototype.wgEndpointOptions)),

            async function WgEndpointController_wgEndpointOptions(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgEndpointController_wgEndpointOptions, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgEndpointController>(WgEndpointController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgEndpointOptions',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgEndpointController_getWgEndpoint: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/endpoints/:id',
            authenticateMiddleware([{"jwt":["permission:wg:endpoint:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgEndpointController)),
            ...(fetchMiddlewares<Middleware>(WgEndpointController.prototype.getWgEndpoint)),

            async function WgEndpointController_getWgEndpoint(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgEndpointController_getWgEndpoint, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgEndpointController>(WgEndpointController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getWgEndpoint',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgEndpointController_updateWgEndpoint: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IUpdateWgEndpointBody"},
        };
        router.patch('/api/v1/wg/endpoints/:id',
            authenticateMiddleware([{"jwt":["permission:wg:endpoint:update"]}]),
            ...(fetchMiddlewares<Middleware>(WgEndpointController)),
            ...(fetchMiddlewares<Middleware>(WgEndpointController.prototype.updateWgEndpoint)),

            async function WgEndpointController_updateWgEndpoint(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgEndpointController_updateWgEndpoint, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgEndpointController>(WgEndpointController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateWgEndpoint',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgEndpointController_deleteWgEndpoint: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/wg/endpoints/:id',
            authenticateMiddleware([{"jwt":["permission:wg:endpoint:delete"]}]),
            ...(fetchMiddlewares<Middleware>(WgEndpointController)),
            ...(fetchMiddlewares<Middleware>(WgEndpointController.prototype.deleteWgEndpoint)),

            async function WgEndpointController_deleteWgEndpoint(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgEndpointController_deleteWgEndpoint, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgEndpointController>(WgEndpointController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deleteWgEndpoint',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_createWgInterface: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"ICreateWgInterfaceBody"},
        };
        router.post('/api/v1/wg/interfaces',
            authenticateMiddleware([{"jwt":["permission:wg:interface:create"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.createWgInterface)),

            async function WgInterfaceController_createWgInterface(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_createWgInterface, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'createWgInterface',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_listWgInterfaces: Record<string, TsoaRoute.ParameterSchema> = {
                nodeId: {"in":"query","name":"nodeId","ref":"UUID"},
                endpointId: {"in":"query","name":"endpointId","ref":"UUID"},
                enabled: {"in":"query","name":"enabled","dataType":"boolean"},
                query: {"in":"query","name":"query","dataType":"string"},
                offset: {"in":"query","name":"offset","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        router.get('/api/v1/wg/interfaces',
            authenticateMiddleware([{"jwt":["permission:wg:interface:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.listWgInterfaces)),

            async function WgInterfaceController_listWgInterfaces(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_listWgInterfaces, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'listWgInterfaces',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_wgInterfaceOptions: Record<string, TsoaRoute.ParameterSchema> = {
                nodeId: {"in":"query","name":"nodeId","ref":"UUID"},
        };
        router.get('/api/v1/wg/interfaces/options',
            authenticateMiddleware([{"jwt":["permission:wg:interface:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.wgInterfaceOptions)),

            async function WgInterfaceController_wgInterfaceOptions(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_wgInterfaceOptions, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgInterfaceOptions',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_getWgInterface: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/interfaces/:id',
            authenticateMiddleware([{"jwt":["permission:wg:interface:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.getWgInterface)),

            async function WgInterfaceController_getWgInterface(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_getWgInterface, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getWgInterface',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_updateWgInterface: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IUpdateWgInterfaceBody"},
        };
        router.patch('/api/v1/wg/interfaces/:id',
            authenticateMiddleware([{"jwt":["permission:wg:interface:update"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.updateWgInterface)),

            async function WgInterfaceController_updateWgInterface(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_updateWgInterface, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateWgInterface',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_deleteWgInterface: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/wg/interfaces/:id',
            authenticateMiddleware([{"jwt":["permission:wg:interface:delete"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.deleteWgInterface)),

            async function WgInterfaceController_deleteWgInterface(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_deleteWgInterface, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deleteWgInterface',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_enableWgInterface: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/wg/interfaces/:id/enable',
            authenticateMiddleware([{"jwt":["permission:wg:interface:control"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.enableWgInterface)),

            async function WgInterfaceController_enableWgInterface(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_enableWgInterface, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'enableWgInterface',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_disableWgInterface: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/wg/interfaces/:id/disable',
            authenticateMiddleware([{"jwt":["permission:wg:interface:control"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.disableWgInterface)),

            async function WgInterfaceController_disableWgInterface(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_disableWgInterface, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'disableWgInterface',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_moveWgInterface: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IMoveWgInterfaceBody"},
        };
        router.post('/api/v1/wg/interfaces/:id/move',
            authenticateMiddleware([{"jwt":["permission:wg:interface:move"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.moveWgInterface)),

            async function WgInterfaceController_moveWgInterface(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_moveWgInterface, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'moveWgInterface',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_addWgInterfaceReplica: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IAddWgInterfaceReplicaBody"},
        };
        router.post('/api/v1/wg/interfaces/:id/replicas',
            authenticateMiddleware([{"jwt":["permission:wg:interface:replicas"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.addWgInterfaceReplica)),

            async function WgInterfaceController_addWgInterfaceReplica(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_addWgInterfaceReplica, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'addWgInterfaceReplica',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_removeWgInterfaceReplica: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                nodeId: {"in":"path","name":"nodeId","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/wg/interfaces/:id/replicas/:nodeId',
            authenticateMiddleware([{"jwt":["permission:wg:interface:replicas"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.removeWgInterfaceReplica)),

            async function WgInterfaceController_removeWgInterfaceReplica(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_removeWgInterfaceReplica, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'removeWgInterfaceReplica',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgInterfaceController_restartWgInterface: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/wg/interfaces/:id/restart',
            authenticateMiddleware([{"jwt":["permission:wg:interface:control"]}]),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController)),
            ...(fetchMiddlewares<Middleware>(WgInterfaceController.prototype.restartWgInterface)),

            async function WgInterfaceController_restartWgInterface(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgInterfaceController_restartWgInterface, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgInterfaceController>(WgInterfaceController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'restartWgInterface',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_createWgPeer: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"ICreateWgPeerBody"},
        };
        router.post('/api/v1/wg/peers',
            authenticateMiddleware([{"jwt":["permission:wg:peer:create"]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.createWgPeer)),

            async function WgPeerController_createWgPeer(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_createWgPeer, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'createWgPeer',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_listWgPeers: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                interfaceId: {"in":"query","name":"interfaceId","ref":"UUID"},
                nodeId: {"in":"query","name":"nodeId","ref":"UUID"},
                userId: {"in":"query","name":"userId","ref":"UUID"},
                enabled: {"in":"query","name":"enabled","dataType":"boolean"},
                online: {"in":"query","name":"online","dataType":"boolean"},
                query: {"in":"query","name":"query","dataType":"string"},
                offset: {"in":"query","name":"offset","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        router.get('/api/v1/wg/peers',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.listWgPeers)),

            async function WgPeerController_listWgPeers(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_listWgPeers, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'listWgPeers',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_wgPeerOptions: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.get('/api/v1/wg/peers/options',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.wgPeerOptions)),

            async function WgPeerController_wgPeerOptions(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_wgPeerOptions, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgPeerOptions',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_getWgPeer: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/peers/:id',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.getWgPeer)),

            async function WgPeerController_getWgPeer(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_getWgPeer, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getWgPeer',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_updateWgPeer: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IUpdateWgPeerBody"},
        };
        router.patch('/api/v1/wg/peers/:id',
            authenticateMiddleware([{"jwt":["permission:wg:peer:update"]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.updateWgPeer)),

            async function WgPeerController_updateWgPeer(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_updateWgPeer, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateWgPeer',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_deleteWgPeer: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/wg/peers/:id',
            authenticateMiddleware([{"jwt":["permission:wg:peer:delete"]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.deleteWgPeer)),

            async function WgPeerController_deleteWgPeer(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_deleteWgPeer, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deleteWgPeer',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_enableWgPeer: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/wg/peers/:id/enable',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.enableWgPeer)),

            async function WgPeerController_enableWgPeer(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_enableWgPeer, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'enableWgPeer',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_disableWgPeer: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/wg/peers/:id/disable',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.disableWgPeer)),

            async function WgPeerController_disableWgPeer(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_disableWgPeer, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'disableWgPeer',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_rotateWgPeerPsk: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/wg/peers/:id/psk/rotate',
            authenticateMiddleware([{"jwt":["permission:wg:peer:psk"]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.rotateWgPeerPsk)),

            async function WgPeerController_rotateWgPeerPsk(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_rotateWgPeerPsk, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'rotateWgPeerPsk',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_removeWgPeerPsk: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/wg/peers/:id/psk',
            authenticateMiddleware([{"jwt":["permission:wg:peer:psk"]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.removeWgPeerPsk)),

            async function WgPeerController_removeWgPeerPsk(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_removeWgPeerPsk, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'removeWgPeerPsk',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_assignWgPeer: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IAssignWgPeerBody"},
        };
        router.post('/api/v1/wg/peers/:id/assign',
            authenticateMiddleware([{"jwt":["permission:wg:peer:assign"]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.assignWgPeer)),

            async function WgPeerController_assignWgPeer(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_assignWgPeer, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'assignWgPeer',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_revokeWgPeer: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/wg/peers/:id/revoke',
            authenticateMiddleware([{"jwt":["permission:wg:peer:assign"]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.revokeWgPeer)),

            async function WgPeerController_revokeWgPeer(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_revokeWgPeer, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'revokeWgPeer',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_wgPeerConfig: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/peers/:id/config',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.wgPeerConfig)),

            async function WgPeerController_wgPeerConfig(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_wgPeerConfig, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgPeerConfig',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgPeerController_wgPeerQr: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/peers/:id/qr',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgPeerController)),
            ...(fetchMiddlewares<Middleware>(WgPeerController.prototype.wgPeerQr)),

            async function WgPeerController_wgPeerQr(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgPeerController_wgPeerQr, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgPeerController>(WgPeerController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgPeerQr',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgStatsController_wgStatsOverview: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.get('/api/v1/wg/stats/overview',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgStatsController)),
            ...(fetchMiddlewares<Middleware>(WgStatsController.prototype.wgStatsOverview)),

            async function WgStatsController_wgStatsOverview(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgStatsController_wgStatsOverview, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgStatsController>(WgStatsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgStatsOverview',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgStatsController_wgStatsSeries: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                from: {"in":"query","name":"from","dataType":"datetime"},
                to: {"in":"query","name":"to","dataType":"datetime"},
                stepSec: {"in":"query","name":"stepSec","dataType":"double"},
                groupBy: {"in":"query","name":"groupBy","ref":"EWgSeriesGroupBy"},
                nodeId: {"in":"query","name":"nodeId","ref":"UUID"},
                interfaceId: {"in":"query","name":"interfaceId","ref":"UUID"},
                peerId: {"in":"query","name":"peerId","ref":"UUID"},
                userId: {"in":"query","name":"userId","ref":"UUID"},
        };
        router.get('/api/v1/wg/stats/series',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgStatsController)),
            ...(fetchMiddlewares<Middleware>(WgStatsController.prototype.wgStatsSeries)),

            async function WgStatsController_wgStatsSeries(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgStatsController_wgStatsSeries, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgStatsController>(WgStatsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgStatsSeries',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgStatsController_wgStatsCurrentPeer: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                peerId: {"in":"path","name":"peerId","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/stats/current/peer/:peerId',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgStatsController)),
            ...(fetchMiddlewares<Middleware>(WgStatsController.prototype.wgStatsCurrentPeer)),

            async function WgStatsController_wgStatsCurrentPeer(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgStatsController_wgStatsCurrentPeer, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgStatsController>(WgStatsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgStatsCurrentPeer',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgStatsController_wgStatsCurrentInterface: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                interfaceId: {"in":"path","name":"interfaceId","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/stats/current/interface/:interfaceId',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgStatsController)),
            ...(fetchMiddlewares<Middleware>(WgStatsController.prototype.wgStatsCurrentInterface)),

            async function WgStatsController_wgStatsCurrentInterface(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgStatsController_wgStatsCurrentInterface, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgStatsController>(WgStatsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgStatsCurrentInterface',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgStatsController_wgStatsCurrentNode: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                nodeId: {"in":"path","name":"nodeId","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/stats/current/node/:nodeId',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgStatsController)),
            ...(fetchMiddlewares<Middleware>(WgStatsController.prototype.wgStatsCurrentNode)),

            async function WgStatsController_wgStatsCurrentNode(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgStatsController_wgStatsCurrentNode, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgStatsController>(WgStatsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgStatsCurrentNode',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgStatsController_wgStatsPeerWindow: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                peerId: {"in":"path","name":"peerId","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/stats/window/peer/:peerId',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgStatsController)),
            ...(fetchMiddlewares<Middleware>(WgStatsController.prototype.wgStatsPeerWindow)),

            async function WgStatsController_wgStatsPeerWindow(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgStatsController_wgStatsPeerWindow, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgStatsController>(WgStatsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgStatsPeerWindow',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgStatsController_wgStatsInterfaceWindow: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                interfaceId: {"in":"path","name":"interfaceId","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/stats/window/interface/:interfaceId',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgStatsController)),
            ...(fetchMiddlewares<Middleware>(WgStatsController.prototype.wgStatsInterfaceWindow)),

            async function WgStatsController_wgStatsInterfaceWindow(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgStatsController_wgStatsInterfaceWindow, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgStatsController>(WgStatsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgStatsInterfaceWindow',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgStatsController_wgStatsNodeWindow: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                nodeId: {"in":"path","name":"nodeId","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/stats/window/node/:nodeId',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgStatsController)),
            ...(fetchMiddlewares<Middleware>(WgStatsController.prototype.wgStatsNodeWindow)),

            async function WgStatsController_wgStatsNodeWindow(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgStatsController_wgStatsNodeWindow, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgStatsController>(WgStatsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgStatsNodeWindow',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgStatsController_wgStatsMesh: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.get('/api/v1/wg/stats/mesh',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgStatsController)),
            ...(fetchMiddlewares<Middleware>(WgStatsController.prototype.wgStatsMesh)),

            async function WgStatsController_wgStatsMesh(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgStatsController_wgStatsMesh, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgStatsController>(WgStatsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgStatsMesh',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgStatsController_wgStatsNodeLinks: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                nodeId: {"in":"path","name":"nodeId","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/stats/links/node/:nodeId',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(WgStatsController)),
            ...(fetchMiddlewares<Middleware>(WgStatsController.prototype.wgStatsNodeLinks)),

            async function WgStatsController_wgStatsNodeLinks(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgStatsController_wgStatsNodeLinks, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgStatsController>(WgStatsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgStatsNodeLinks',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgStatsController_wgNodeMetrics: Record<string, TsoaRoute.ParameterSchema> = {
                nodeId: {"in":"query","name":"nodeId","required":true,"ref":"UUID"},
                from: {"in":"query","name":"from","dataType":"datetime"},
                to: {"in":"query","name":"to","dataType":"datetime"},
                stepSec: {"in":"query","name":"stepSec","dataType":"double"},
        };
        router.get('/api/v1/wg/stats/node-metrics',
            authenticateMiddleware([{"jwt":["permission:wg:node:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgStatsController)),
            ...(fetchMiddlewares<Middleware>(WgStatsController.prototype.wgNodeMetrics)),

            async function WgStatsController_wgNodeMetrics(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgStatsController_wgNodeMetrics, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgStatsController>(WgStatsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgNodeMetrics',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsRoleController_getRoles: Record<string, TsoaRoute.ParameterSchema> = {
        };
        router.get('/api/v1/roles',
            authenticateMiddleware([{"jwt":["permission:role:view"]}]),
            ...(fetchMiddlewares<Middleware>(RoleController)),
            ...(fetchMiddlewares<Middleware>(RoleController.prototype.getRoles)),

            async function RoleController_getRoles(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsRoleController_getRoles, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<RoleController>(RoleController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getRoles',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsRoleController_createRole: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"ICreateRoleRequestDto"},
        };
        router.post('/api/v1/roles',
            authenticateMiddleware([{"jwt":["permission:role:create"]}]),
            ...(fetchMiddlewares<Middleware>(RoleController)),
            ...(fetchMiddlewares<Middleware>(RoleController.prototype.createRole)),

            async function RoleController_createRole(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsRoleController_createRole, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<RoleController>(RoleController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'createRole',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsRoleController_deleteRole: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/roles/:id',
            authenticateMiddleware([{"jwt":["permission:role:delete"]}]),
            ...(fetchMiddlewares<Middleware>(RoleController)),
            ...(fetchMiddlewares<Middleware>(RoleController.prototype.deleteRole)),

            async function RoleController_deleteRole(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsRoleController_deleteRole, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<RoleController>(RoleController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deleteRole',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsRoleController_setRolePermissions: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IRolePermissionsRequestDto"},
        };
        router.patch('/api/v1/roles/:id/permissions',
            authenticateMiddleware([{"jwt":["permission:role:update"]}]),
            ...(fetchMiddlewares<Middleware>(RoleController)),
            ...(fetchMiddlewares<Middleware>(RoleController.prototype.setRolePermissions)),

            async function RoleController_setRolePermissions(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsRoleController_setRolePermissions, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<RoleController>(RoleController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'setRolePermissions',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_createWgSocks: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"ICreateWgSocksBody"},
        };
        router.post('/api/v1/wg/socks',
            authenticateMiddleware([{"jwt":["permission:wg:socks:create"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.createWgSocks)),

            async function WgSocksController_createWgSocks(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_createWgSocks, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'createWgSocks',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_listWgSocks: Record<string, TsoaRoute.ParameterSchema> = {
        };
        router.get('/api/v1/wg/socks',
            authenticateMiddleware([{"jwt":["permission:wg:socks:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.listWgSocks)),

            async function WgSocksController_listWgSocks(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_listWgSocks, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'listWgSocks',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_getWgSocks: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/socks/:id',
            authenticateMiddleware([{"jwt":["permission:wg:socks:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.getWgSocks)),

            async function WgSocksController_getWgSocks(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_getWgSocks, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getWgSocks',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_updateWgSocks: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IUpdateWgSocksBody"},
        };
        router.patch('/api/v1/wg/socks/:id',
            authenticateMiddleware([{"jwt":["permission:wg:socks:update"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.updateWgSocks)),

            async function WgSocksController_updateWgSocks(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_updateWgSocks, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateWgSocks',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_deleteWgSocks: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/wg/socks/:id',
            authenticateMiddleware([{"jwt":["permission:wg:socks:delete"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.deleteWgSocks)),

            async function WgSocksController_deleteWgSocks(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_deleteWgSocks, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deleteWgSocks',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_addWgSocksUser: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"ICreateWgSocksUserBody"},
        };
        router.post('/api/v1/wg/socks/:id/users',
            authenticateMiddleware([{"jwt":["permission:wg:socks:users"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.addWgSocksUser)),

            async function WgSocksController_addWgSocksUser(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_addWgSocksUser, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'addWgSocksUser',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_updateWgSocksUser: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                userId: {"in":"path","name":"userId","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IUpdateWgSocksUserBody"},
        };
        router.patch('/api/v1/wg/socks/:id/users/:userId',
            authenticateMiddleware([{"jwt":["permission:wg:socks:users"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.updateWgSocksUser)),

            async function WgSocksController_updateWgSocksUser(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_updateWgSocksUser, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateWgSocksUser',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_removeWgSocksUser: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                userId: {"in":"path","name":"userId","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/wg/socks/:id/users/:userId',
            authenticateMiddleware([{"jwt":["permission:wg:socks:users"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.removeWgSocksUser)),

            async function WgSocksController_removeWgSocksUser(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_removeWgSocksUser, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'removeWgSocksUser',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_getWgSocksUserSecret: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                userId: {"in":"path","name":"userId","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/socks/:id/users/:userId/secret',
            authenticateMiddleware([{"jwt":["permission:wg:socks:secrets"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.getWgSocksUserSecret)),

            async function WgSocksController_getWgSocksUserSecret(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_getWgSocksUserSecret, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getWgSocksUserSecret',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_issueWgSocksClient: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"ICreateWgSocksClientBody"},
        };
        router.post('/api/v1/wg/socks/:id/clients',
            authenticateMiddleware([{"jwt":["permission:wg:socks:clients"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.issueWgSocksClient)),

            async function WgSocksController_issueWgSocksClient(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_issueWgSocksClient, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'issueWgSocksClient',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_revokeWgSocksClient: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                clientId: {"in":"path","name":"clientId","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/wg/socks/:id/clients/:clientId/revoke',
            authenticateMiddleware([{"jwt":["permission:wg:socks:clients"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.revokeWgSocksClient)),

            async function WgSocksController_revokeWgSocksClient(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_revokeWgSocksClient, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'revokeWgSocksClient',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgSocksController_getWgSocksMacClient: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                clientId: {"in":"path","name":"clientId","required":true,"ref":"UUID"},
                userId: {"in":"query","name":"userId","ref":"UUID"},
        };
        router.get('/api/v1/wg/socks/:id/clients/:clientId/mac',
            authenticateMiddleware([{"jwt":["permission:wg:socks:clients"]}]),
            ...(fetchMiddlewares<Middleware>(WgSocksController)),
            ...(fetchMiddlewares<Middleware>(WgSocksController.prototype.getWgSocksMacClient)),

            async function WgSocksController_getWgSocksMacClient(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgSocksController_getWgSocksMacClient, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgSocksController>(WgSocksController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getWgSocksMacClient',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgProvisionController_provisionWgNode: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IProvisionWgNodeBody"},
        };
        router.post('/api/v1/wg/nodes/:id/provision',
            authenticateMiddleware([{"jwt":["permission:wg:node:provision"]}]),
            ...(fetchMiddlewares<Middleware>(WgProvisionController)),
            ...(fetchMiddlewares<Middleware>(WgProvisionController.prototype.provisionWgNode)),

            async function WgProvisionController_provisionWgNode(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgProvisionController_provisionWgNode, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgProvisionController>(WgProvisionController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'provisionWgNode',
              controller,
              context,
              validatedArgs,
              successStatus: 202,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgProvisionController_uninstallWgNode: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IUninstallWgNodeBody"},
        };
        router.post('/api/v1/wg/nodes/:id/uninstall',
            authenticateMiddleware([{"jwt":["permission:wg:node:provision"]}]),
            ...(fetchMiddlewares<Middleware>(WgProvisionController)),
            ...(fetchMiddlewares<Middleware>(WgProvisionController.prototype.uninstallWgNode)),

            async function WgProvisionController_uninstallWgNode(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgProvisionController_uninstallWgNode, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgProvisionController>(WgProvisionController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'uninstallWgNode',
              controller,
              context,
              validatedArgs,
              successStatus: 202,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgForwardController_createWgForward: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"ICreateWgForwardBody"},
        };
        router.post('/api/v1/wg/forwards',
            authenticateMiddleware([{"jwt":["permission:wg:forward:create"]}]),
            ...(fetchMiddlewares<Middleware>(WgForwardController)),
            ...(fetchMiddlewares<Middleware>(WgForwardController.prototype.createWgForward)),

            async function WgForwardController_createWgForward(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgForwardController_createWgForward, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgForwardController>(WgForwardController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'createWgForward',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgForwardController_listWgForwards: Record<string, TsoaRoute.ParameterSchema> = {
                offset: {"in":"query","name":"offset","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        router.get('/api/v1/wg/forwards',
            authenticateMiddleware([{"jwt":["permission:wg:forward:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgForwardController)),
            ...(fetchMiddlewares<Middleware>(WgForwardController.prototype.listWgForwards)),

            async function WgForwardController_listWgForwards(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgForwardController_listWgForwards, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgForwardController>(WgForwardController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'listWgForwards',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgForwardController_getWgForward: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/wg/forwards/:id',
            authenticateMiddleware([{"jwt":["permission:wg:forward:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgForwardController)),
            ...(fetchMiddlewares<Middleware>(WgForwardController.prototype.getWgForward)),

            async function WgForwardController_getWgForward(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgForwardController_getWgForward, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgForwardController>(WgForwardController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getWgForward',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgForwardController_updateWgForward: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IUpdateWgForwardBody"},
        };
        router.patch('/api/v1/wg/forwards/:id',
            authenticateMiddleware([{"jwt":["permission:wg:forward:update"]}]),
            ...(fetchMiddlewares<Middleware>(WgForwardController)),
            ...(fetchMiddlewares<Middleware>(WgForwardController.prototype.updateWgForward)),

            async function WgForwardController_updateWgForward(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgForwardController_updateWgForward, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgForwardController>(WgForwardController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateWgForward',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgForwardController_deleteWgForward: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/wg/forwards/:id',
            authenticateMiddleware([{"jwt":["permission:wg:forward:delete"]}]),
            ...(fetchMiddlewares<Middleware>(WgForwardController)),
            ...(fetchMiddlewares<Middleware>(WgForwardController.prototype.deleteWgForward)),

            async function WgForwardController_deleteWgForward(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgForwardController_deleteWgForward, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgForwardController>(WgForwardController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deleteWgForward',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsJobsController_listJobs: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                status: {"in":"query","name":"status","ref":"EJobRunStatus"},
                scopeType: {"in":"query","name":"scopeType","dataType":"string"},
                scopeId: {"in":"query","name":"scopeId","dataType":"string"},
                offset: {"in":"query","name":"offset","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        router.get('/api/v1/jobs',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(JobsController)),
            ...(fetchMiddlewares<Middleware>(JobsController.prototype.listJobs)),

            async function JobsController_listJobs(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsJobsController_listJobs, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<JobsController>(JobsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'listJobs',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsJobsController_getJob: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/jobs/:id',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(JobsController)),
            ...(fetchMiddlewares<Middleware>(JobsController.prototype.getJob)),

            async function JobsController_getJob(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsJobsController_getJob, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<JobsController>(JobsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getJob',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsJobsController_cancelJob: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/jobs/:id/cancel',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(JobsController)),
            ...(fetchMiddlewares<Middleware>(JobsController.prototype.cancelJob)),

            async function JobsController_cancelJob(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsJobsController_cancelJob, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<JobsController>(JobsController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'cancelJob',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgAgentController_wgAgentState: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                knownVersion: {"in":"query","name":"knownVersion","dataType":"double"},
                waitMs: {"in":"query","name":"waitMs","dataType":"double"},
        };
        router.get('/api/v1/wg-agent/state',
            authenticateMiddleware([{"apiKey":["wg-agent"]}]),
            ...(fetchMiddlewares<Middleware>(WgAgentController)),
            ...(fetchMiddlewares<Middleware>(WgAgentController.prototype.wgAgentState)),

            async function WgAgentController_wgAgentState(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgAgentController_wgAgentState, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgAgentController>(WgAgentController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgAgentState',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgAgentController_wgAgentReport: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IWgAgentReportBody"},
        };
        router.post('/api/v1/wg-agent/state',
            authenticateMiddleware([{"apiKey":["wg-agent"]}]),
            ...(fetchMiddlewares<Middleware>(WgAgentController)),
            ...(fetchMiddlewares<Middleware>(WgAgentController.prototype.wgAgentReport)),

            async function WgAgentController_wgAgentReport(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgAgentController_wgAgentReport, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgAgentController>(WgAgentController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgAgentReport',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgAgentController_wgAgentStats: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IWgAgentStatsBody"},
        };
        router.post('/api/v1/wg-agent/stats',
            authenticateMiddleware([{"apiKey":["wg-agent"]}]),
            ...(fetchMiddlewares<Middleware>(WgAgentController)),
            ...(fetchMiddlewares<Middleware>(WgAgentController.prototype.wgAgentStats)),

            async function WgAgentController_wgAgentStats(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgAgentController_wgAgentStats, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgAgentController>(WgAgentController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgAgentStats',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgAgentController_wgAgentCommandAck: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/wg-agent/commands/:id/ack',
            authenticateMiddleware([{"apiKey":["wg-agent"]}]),
            ...(fetchMiddlewares<Middleware>(WgAgentController)),
            ...(fetchMiddlewares<Middleware>(WgAgentController.prototype.wgAgentCommandAck)),

            async function WgAgentController_wgAgentCommandAck(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgAgentController_wgAgentCommandAck, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgAgentController>(WgAgentController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgAgentCommandAck',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgAgentController_wgAgentCommandOutput: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IWgAgentCommandOutputBody"},
        };
        router.post('/api/v1/wg-agent/commands/:id/output',
            authenticateMiddleware([{"apiKey":["wg-agent"]}]),
            ...(fetchMiddlewares<Middleware>(WgAgentController)),
            ...(fetchMiddlewares<Middleware>(WgAgentController.prototype.wgAgentCommandOutput)),

            async function WgAgentController_wgAgentCommandOutput(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgAgentController_wgAgentCommandOutput, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgAgentController>(WgAgentController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgAgentCommandOutput',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgAgentController_wgAgentCommandComplete: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IWgAgentCommandCompleteBody"},
        };
        router.post('/api/v1/wg-agent/commands/:id/complete',
            authenticateMiddleware([{"apiKey":["wg-agent"]}]),
            ...(fetchMiddlewares<Middleware>(WgAgentController)),
            ...(fetchMiddlewares<Middleware>(WgAgentController.prototype.wgAgentCommandComplete)),

            async function WgAgentController_wgAgentCommandComplete(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgAgentController_wgAgentCommandComplete, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgAgentController>(WgAgentController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgAgentCommandComplete',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgAgentController_wgAgentBinary: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                arch: {"in":"path","name":"arch","required":true,"dataType":"string"},
        };
        router.get('/api/v1/wg-agent/binary/:arch',
            authenticateMiddleware([{"apiKey":["wg-agent"]}]),
            ...(fetchMiddlewares<Middleware>(WgAgentController)),
            ...(fetchMiddlewares<Middleware>(WgAgentController.prototype.wgAgentBinary)),

            async function WgAgentController_wgAgentBinary(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgAgentController_wgAgentBinary, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgAgentController>(WgAgentController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgAgentBinary',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgAgentController_wgAgentInstallScript: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.get('/api/v1/wg-agent/install.sh',
            ...(fetchMiddlewares<Middleware>(WgAgentController)),
            ...(fetchMiddlewares<Middleware>(WgAgentController.prototype.wgAgentInstallScript)),

            async function WgAgentController_wgAgentInstallScript(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgAgentController_wgAgentInstallScript, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgAgentController>(WgAgentController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgAgentInstallScript',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgAgentUpdateController_wgAgentRelease: Record<string, TsoaRoute.ParameterSchema> = {
        };
        router.get('/api/v1/wg/agent/release',
            authenticateMiddleware([{"jwt":["permission:wg:node:view"]}]),
            ...(fetchMiddlewares<Middleware>(WgAgentUpdateController)),
            ...(fetchMiddlewares<Middleware>(WgAgentUpdateController.prototype.wgAgentRelease)),

            async function WgAgentUpdateController_wgAgentRelease(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgAgentUpdateController_wgAgentRelease, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgAgentUpdateController>(WgAgentUpdateController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'wgAgentRelease',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWgAgentUpdateController_updateWgAgent: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                nodeId: {"in":"path","name":"nodeId","required":true,"ref":"UUID"},
        };
        router.post('/api/v1/wg/agent/nodes/:nodeId/update',
            authenticateMiddleware([{"jwt":["permission:wg:node:agent"]}]),
            ...(fetchMiddlewares<Middleware>(WgAgentUpdateController)),
            ...(fetchMiddlewares<Middleware>(WgAgentUpdateController.prototype.updateWgAgent)),

            async function WgAgentUpdateController_updateWgAgent(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsWgAgentUpdateController_updateWgAgent, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<WgAgentUpdateController>(WgAgentUpdateController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateWgAgent',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_getMyUser: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.get('/api/v1/user/my',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.getMyUser)),

            async function UserController_getMyUser(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_getMyUser, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getMyUser',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_updateMyUser: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IUserUpdateRequestDto"},
        };
        router.patch('/api/v1/user/my/update',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.updateMyUser)),

            async function UserController_updateMyUser(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_updateMyUser, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateMyUser',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_confirmEmailChange: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IUserConfirmEmailChangeDto"},
        };
        router.post('/api/v1/user/my/email/confirm',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.confirmEmailChange)),

            async function UserController_confirmEmailChange(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_confirmEmailChange, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'confirmEmailChange',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_deleteMyUser: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IUserDeleteDto"},
        };
        router.post('/api/v1/user/my/delete',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.deleteMyUser)),

            async function UserController_deleteMyUser(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_deleteMyUser, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deleteMyUser',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_setUsername: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"username":{"dataType":"string","required":true}}},
        };
        router.patch('/api/v1/user/my/username',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.setUsername)),

            async function UserController_setUsername(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_setUsername, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'setUsername',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_getUsers: Record<string, TsoaRoute.ParameterSchema> = {
                offset: {"in":"query","name":"offset","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
                query: {"in":"query","name":"query","dataType":"string"},
        };
        router.get('/api/v1/user/all',
            authenticateMiddleware([{"jwt":["permission:user:view"]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.getUsers)),

            async function UserController_getUsers(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_getUsers, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getUsers',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_getUserOptions: Record<string, TsoaRoute.ParameterSchema> = {
                query: {"in":"query","name":"query","dataType":"string"},
        };
        router.get('/api/v1/user/options',
            authenticateMiddleware([{"jwt":["permission:user:view"]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.getUserOptions)),

            async function UserController_getUserOptions(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_getUserOptions, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getUserOptions',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_getUserById: Record<string, TsoaRoute.ParameterSchema> = {
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/user/:id',
            authenticateMiddleware([{"jwt":["permission:user:view"]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.getUserById)),

            async function UserController_getUserById(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_getUserById, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getUserById',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_setPrivileges: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IUserPrivilegesRequestDto"},
        };
        router.patch('/api/v1/user/setPrivileges/:id',
            authenticateMiddleware([{"jwt":["permission:user:privileges"]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.setPrivileges)),

            async function UserController_setPrivileges(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_setPrivileges, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'setPrivileges',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_requestVerifyEmail: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.post('/api/v1/user/verify-email/request',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.requestVerifyEmail)),

            async function UserController_requestVerifyEmail(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_requestVerifyEmail, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'requestVerifyEmail',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_verifyEmail: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IUserVerifyEmailDto"},
        };
        router.post('/api/v1/user/verify-email',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.verifyEmail)),

            async function UserController_verifyEmail(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_verifyEmail, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'verifyEmail',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_updateUser: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IUserUpdateRequestDto"},
        };
        router.patch('/api/v1/user/update/:id',
            authenticateMiddleware([{"jwt":["permission:user:update"]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.updateUser)),

            async function UserController_updateUser(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_updateUser, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateUser',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_changePassword: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IUserChangePasswordDto"},
        };
        router.post('/api/v1/user/changePassword',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.changePassword)),

            async function UserController_changePassword(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_changePassword, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'changePassword',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserController_deleteUser: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/user/delete/:id',
            authenticateMiddleware([{"jwt":["permission:user:delete"]}]),
            ...(fetchMiddlewares<Middleware>(UserController)),
            ...(fetchMiddlewares<Middleware>(UserController.prototype.deleteUser)),

            async function UserController_deleteUser(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsUserController_deleteUser, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<UserController>(UserController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deleteUser',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsSessionController_getSessions: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                offset: {"in":"query","name":"offset","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        router.get('/api/v1/session',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(SessionController)),
            ...(fetchMiddlewares<Middleware>(SessionController.prototype.getSessions)),

            async function SessionController_getSessions(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsSessionController_getSessions, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<SessionController>(SessionController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getSessions',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsSessionController_terminateSession: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/session/:id',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(SessionController)),
            ...(fetchMiddlewares<Middleware>(SessionController.prototype.terminateSession)),

            async function SessionController_terminateSession(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsSessionController_terminateSession, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<SessionController>(SessionController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'terminateSession',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsSessionController_terminateOtherSessions: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.post('/api/v1/session/terminate-others',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(SessionController)),
            ...(fetchMiddlewares<Middleware>(SessionController.prototype.terminateOtherSessions)),

            async function SessionController_terminateOtherSessions(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsSessionController_terminateOtherSessions, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<SessionController>(SessionController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'terminateOtherSessions',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsProfileController_getMyProfile: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.get('/api/v1/profile/my',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(ProfileController)),
            ...(fetchMiddlewares<Middleware>(ProfileController.prototype.getMyProfile)),

            async function ProfileController_getMyProfile(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsProfileController_getMyProfile, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<ProfileController>(ProfileController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getMyProfile',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsProfileController_updateMyProfile: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IProfileUpdateRequestDto"},
        };
        router.patch('/api/v1/profile/my/update',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(ProfileController)),
            ...(fetchMiddlewares<Middleware>(ProfileController.prototype.updateMyProfile)),

            async function ProfileController_updateMyProfile(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsProfileController_updateMyProfile, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<ProfileController>(ProfileController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateMyProfile',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsProfileController_deleteMyProfile: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.delete('/api/v1/profile/my/delete',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(ProfileController)),
            ...(fetchMiddlewares<Middleware>(ProfileController.prototype.deleteMyProfile)),

            async function ProfileController_deleteMyProfile(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsProfileController_deleteMyProfile, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<ProfileController>(ProfileController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deleteMyProfile',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsProfileController_getProfiles: Record<string, TsoaRoute.ParameterSchema> = {
                offset: {"in":"query","name":"offset","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        router.get('/api/v1/profile/all',
            authenticateMiddleware([{"jwt":["permission:profile:view"]}]),
            ...(fetchMiddlewares<Middleware>(ProfileController)),
            ...(fetchMiddlewares<Middleware>(ProfileController.prototype.getProfiles)),

            async function ProfileController_getProfiles(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsProfileController_getProfiles, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<ProfileController>(ProfileController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getProfiles',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsProfileController_getProfileById: Record<string, TsoaRoute.ParameterSchema> = {
                userId: {"in":"path","name":"userId","required":true,"ref":"UUID"},
        };
        router.get('/api/v1/profile/:userId',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(ProfileController)),
            ...(fetchMiddlewares<Middleware>(ProfileController.prototype.getProfileById)),

            async function ProfileController_getProfileById(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsProfileController_getProfileById, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<ProfileController>(ProfileController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getProfileById',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsProfileController_updateProfile: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"ref":"UUID"},
                body: {"in":"body","name":"body","required":true,"ref":"IProfileUpdateRequestDto"},
        };
        router.patch('/api/v1/profile/update/:userId',
            authenticateMiddleware([{"jwt":["permission:profile:update"]}]),
            ...(fetchMiddlewares<Middleware>(ProfileController)),
            ...(fetchMiddlewares<Middleware>(ProfileController.prototype.updateProfile)),

            async function ProfileController_updateProfile(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsProfileController_updateProfile, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<ProfileController>(ProfileController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'updateProfile',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsProfileController_deleteProfile: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"ref":"UUID"},
        };
        router.delete('/api/v1/profile/delete/:userId',
            authenticateMiddleware([{"jwt":["permission:profile:delete"]}]),
            ...(fetchMiddlewares<Middleware>(ProfileController)),
            ...(fetchMiddlewares<Middleware>(ProfileController.prototype.deleteProfile)),

            async function ProfileController_deleteProfile(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsProfileController_deleteProfile, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<ProfileController>(ProfileController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deleteProfile',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_signUp: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"TSignUpRequestDto"},
        };
        router.post('/api/v1/auth/sign-up',
            ...(fetchMiddlewares<Middleware>(AuthController)),
            ...(fetchMiddlewares<Middleware>(AuthController.prototype.signUp)),

            async function AuthController_signUp(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_signUp, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuthController>(AuthController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'signUp',
              controller,
              context,
              validatedArgs,
              successStatus: 201,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_signIn: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"ISignInRequestDto"},
        };
        router.post('/api/v1/auth/sign-in',
            ...(fetchMiddlewares<Middleware>(AuthController)),
            ...(fetchMiddlewares<Middleware>(AuthController.prototype.signIn)),

            async function AuthController_signIn(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_signIn, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuthController>(AuthController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'signIn',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_requestResetPassword: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"IUserLoginRequestDto"},
        };
        router.post('/api/v1/auth/request-reset-password',
            ...(fetchMiddlewares<Middleware>(AuthController)),
            ...(fetchMiddlewares<Middleware>(AuthController.prototype.requestResetPassword)),

            async function AuthController_requestResetPassword(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_requestResetPassword, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuthController>(AuthController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'requestResetPassword',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_resetPassword: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"IUserResetPasswordRequestDto"},
        };
        router.post('/api/v1/auth/reset-password',
            ...(fetchMiddlewares<Middleware>(AuthController)),
            ...(fetchMiddlewares<Middleware>(AuthController.prototype.resetPassword)),

            async function AuthController_resetPassword(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_resetPassword, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuthController>(AuthController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'resetPassword',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_refresh: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IRefreshRequestDto"},
        };
        router.post('/api/v1/auth/refresh',
            ...(fetchMiddlewares<Middleware>(AuthController)),
            ...(fetchMiddlewares<Middleware>(AuthController.prototype.refresh)),

            async function AuthController_refresh(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_refresh, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuthController>(AuthController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'refresh',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_signOut: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.post('/api/v1/auth/sign-out',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(AuthController)),
            ...(fetchMiddlewares<Middleware>(AuthController.prototype.signOut)),

            async function AuthController_signOut(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_signOut, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuthController>(AuthController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'signOut',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_signOutAll: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.post('/api/v1/auth/sign-out-all',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(AuthController)),
            ...(fetchMiddlewares<Middleware>(AuthController.prototype.signOutAll)),

            async function AuthController_signOutAll(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_signOutAll, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuthController>(AuthController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'signOutAll',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_enable2FA: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IEnable2FARequestDto"},
        };
        router.post('/api/v1/auth/enable-2fa',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(AuthController)),
            ...(fetchMiddlewares<Middleware>(AuthController.prototype.enable2FA)),

            async function AuthController_enable2FA(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_enable2FA, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuthController>(AuthController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'enable2FA',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_disable2FA: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IDisable2FARequestDto"},
        };
        router.post('/api/v1/auth/disable-2fa',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(AuthController)),
            ...(fetchMiddlewares<Middleware>(AuthController.prototype.disable2FA)),

            async function AuthController_disable2FA(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_disable2FA, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuthController>(AuthController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'disable2FA',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_verify2FA: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IVerify2FARequestDto"},
        };
        router.post('/api/v1/auth/verify-2fa',
            ...(fetchMiddlewares<Middleware>(AuthController)),
            ...(fetchMiddlewares<Middleware>(AuthController.prototype.verify2FA)),

            async function AuthController_verify2FA(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_verify2FA, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuthController>(AuthController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'verify2FA',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPasskeysController_getPasskeys: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                offset: {"in":"query","name":"offset","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        router.get('/api/v1/passkeys',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(PasskeysController)),
            ...(fetchMiddlewares<Middleware>(PasskeysController.prototype.getPasskeys)),

            async function PasskeysController_getPasskeys(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsPasskeysController_getPasskeys, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<PasskeysController>(PasskeysController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getPasskeys',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPasskeysController_deletePasskey: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                id: {"in":"path","name":"id","required":true,"dataType":"string"},
        };
        router.delete('/api/v1/passkeys/:id',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(PasskeysController)),
            ...(fetchMiddlewares<Middleware>(PasskeysController.prototype.deletePasskey)),

            async function PasskeysController_deletePasskey(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsPasskeysController_deletePasskey, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<PasskeysController>(PasskeysController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'deletePasskey',
              controller,
              context,
              validatedArgs,
              successStatus: 204,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPasskeysController_generateRegistrationOptions: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        router.post('/api/v1/passkeys/generate-registration-options',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(PasskeysController)),
            ...(fetchMiddlewares<Middleware>(PasskeysController.prototype.generateRegistrationOptions)),

            async function PasskeysController_generateRegistrationOptions(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsPasskeysController_generateRegistrationOptions, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<PasskeysController>(PasskeysController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'generateRegistrationOptions',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPasskeysController_verifyRegistration: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IVerifyRegistrationRequestDto"},
        };
        router.post('/api/v1/passkeys/verify-registration',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(PasskeysController)),
            ...(fetchMiddlewares<Middleware>(PasskeysController.prototype.verifyRegistration)),

            async function PasskeysController_verifyRegistration(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsPasskeysController_verifyRegistration, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<PasskeysController>(PasskeysController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'verifyRegistration',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPasskeysController_generateAuthenticationOptions: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"IGenerateAuthenticationOptionsRequestDto"},
        };
        router.post('/api/v1/passkeys/generate-authentication-options',
            ...(fetchMiddlewares<Middleware>(PasskeysController)),
            ...(fetchMiddlewares<Middleware>(PasskeysController.prototype.generateAuthenticationOptions)),

            async function PasskeysController_generateAuthenticationOptions(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsPasskeysController_generateAuthenticationOptions, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<PasskeysController>(PasskeysController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'generateAuthenticationOptions',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPasskeysController_verifyAuthentication: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"IVerifyAuthenticationRequestDto"},
        };
        router.post('/api/v1/passkeys/verify-authentication',
            ...(fetchMiddlewares<Middleware>(PasskeysController)),
            ...(fetchMiddlewares<Middleware>(PasskeysController.prototype.verifyAuthentication)),

            async function PasskeysController_verifyAuthentication(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsPasskeysController_verifyAuthentication, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<PasskeysController>(PasskeysController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'verifyAuthentication',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuditController_getMyAudit: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                cursor: {"in":"query","name":"cursor","dataType":"string"},
                limit: {"in":"query","name":"limit","dataType":"double"},
                type: {"in":"query","name":"type","dataType":"string"},
        };
        router.get('/api/v1/audit/my',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(AuditController)),
            ...(fetchMiddlewares<Middleware>(AuditController.prototype.getMyAudit)),

            async function AuditController_getMyAudit(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuditController_getMyAudit, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuditController>(AuditController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getMyAudit',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuditController_listAuditEvents: Record<string, TsoaRoute.ParameterSchema> = {
                cursor: {"in":"query","name":"cursor","dataType":"string"},
                limit: {"in":"query","name":"limit","dataType":"double"},
                type: {"in":"query","name":"type","dataType":"string"},
                actorId: {"in":"query","name":"actorId","ref":"UUID"},
        };
        router.get('/api/v1/audit',
            authenticateMiddleware([{"jwt":["permission:audit:view"]}]),
            ...(fetchMiddlewares<Middleware>(AuditController)),
            ...(fetchMiddlewares<Middleware>(AuditController.prototype.listAuditEvents)),

            async function AuditController_listAuditEvents(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAuditController_listAuditEvents, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AuditController>(AuditController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'listAuditEvents',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAppInfoController_getAppVersion: Record<string, TsoaRoute.ParameterSchema> = {
        };
        router.get('/api/v1/app/version',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<Middleware>(AppInfoController)),
            ...(fetchMiddlewares<Middleware>(AppInfoController.prototype.getAppVersion)),

            async function AppInfoController_getAppVersion(context: Context, next: Next) {

            let validatedArgs: any[] = [];
            try {
              validatedArgs = templateService.getValidatedArgs({ args: argsAppInfoController_getAppVersion, context, next });
            } catch (err) {
              const error = err as any;
              error.message ||= JSON.stringify({ fields: error.fields });
              context.status = error.status;
              context.throw(context.status, error.message, error);
            }

            const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(context.request) : iocContainer;

            const controller: any = await container.get<AppInfoController>(AppInfoController);
            if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
            }

            return templateService.apiHandler({
              methodName: 'getAppVersion',
              controller,
              context,
              validatedArgs,
              successStatus: undefined,
            });
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa


    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

    function authenticateMiddleware(security: TsoaRoute.Security[] = []) {
        return async function runAuthenticationMiddleware(context: any, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            // keep track of failed auth attempts so we can hand back the most
            // recent one.  This behavior was previously existing so preserving it
            // here
            const failedAttempts: any[] = [];
            const pushAndRethrow = (error: any) => {
                failedAttempts.push(error);
                throw error;
            };

            const secMethodOrPromises: Promise<any>[] = [];
            for (const secMethod of security) {
                if (Object.keys(secMethod).length > 1) {
                    const secMethodAndPromises: Promise<any>[] = [];

                    for (const name in secMethod) {
                        secMethodAndPromises.push(
                            koaAuthenticationRecasted(context.request, name, secMethod[name], context.response)
                                .catch(pushAndRethrow)
                        );
                    }

                    secMethodOrPromises.push(Promise.all(secMethodAndPromises)
                        .then(users => { return users[0]; }));
                } else {
                    for (const name in secMethod) {
                        secMethodOrPromises.push(
                            koaAuthenticationRecasted(context.request, name, secMethod[name], context.response)
                                .catch(pushAndRethrow)
                        );
                    }
                }
            }

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let success;
            try {
                const user = await Promise.any(secMethodOrPromises);
                success = true;
                context.request['user'] = user;
            }
            catch(err) {
                // Response was sent in middleware, abort
                if(context.response.body) {
                    return;
                }

                // Show most recent error as response
                const error = failedAttempts.pop();
                context.status = error.status || 401;
                context.throw(context.status, error.message, error);
            }

            // Response was sent in middleware, abort
            if(context.response.body) {
                return;
            }

            if (success) {
                await next();
            }

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        }
    }

    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
}

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
