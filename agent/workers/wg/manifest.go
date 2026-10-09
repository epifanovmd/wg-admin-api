package main

// Схемы JSON манифеста. Лишние поля разрешены: бэкенд может добавлять поля
// раньше, чем воркер их начнёт понимать.

type schema = map[string]any

func object(properties schema, required ...string) schema {
	result := schema{"type": "object", "properties": properties}
	if len(required) > 0 {
		result["required"] = required
	}

	return result
}

func array(items schema) schema { return schema{"type": "array", "items": items} }

func typed(kind string) schema { return schema{"type": kind} }

func nullable(kind string) schema { return schema{"type": []string{kind, "null"}} }

func port() schema { return schema{"type": "integer", "minimum": 1, "maximum": 65535} }

func enum(values ...string) schema { return schema{"type": "string", "enum": values} }

var (
	interfaceStatusSchema = object(schema{
		"name":    typed("string"),
		"status":  enum("up", "down", "error"),
		"message": typed("string"),
	}, "name", "status")

	routeSchema = object(schema{
		"id":              typed("string"),
		"activeRoute":     enum("tunnel", "direct"),
		"activeCandidate": typed("integer"),
		"activeNodeId":    typed("string"),
	}, "id", "activeRoute")

	stateResultSchema = object(schema{
		"version":    typed("integer"),
		"appliedAt":  typed("integer"),
		"interfaces": array(interfaceStatusSchema),
		"routes":     array(routeSchema),
		"errors":     array(typed("string")),
	}, "version", "appliedAt", "interfaces", "routes", "errors")

	stateSchema = object(schema{
		"version":  typed("integer"),
		"nodeId":   typed("string"),
		"nodeName": typed("string"),
		"interfaces": array(object(schema{
			"name":           schema{"type": "string", "pattern": `^[a-zA-Z0-9_=+.-]{1,15}$`},
			"enabled":        typed("boolean"),
			"listenPort":     port(),
			"addressCidr":    typed("string"),
			"addressV6Cidr":  nullable("string"),
			"privateKey":     typed("string"),
			"mtu":            nullable("integer"),
			"natEnabled":     typed("boolean"),
			"customPostUp":   nullable("string"),
			"customPostDown": nullable("string"),
			"peers": array(object(schema{
				"publicKey":    typed("string"),
				"presharedKey": nullable("string"),
				"allowedIps":   typed("string"),
			}, "publicKey", "allowedIps")),
		}, "name", "enabled", "listenPort", "addressCidr", "privateKey", "natEnabled", "peers")),
		"tunnels": array(object(schema{
			"name":           schema{"type": "string", "pattern": `^wgt\d{1,5}$`},
			"remoteHost":     typed("string"),
			"localTunnelIp":  typed("string"),
			"remoteTunnelIp": typed("string"),
			"prefix":         typed("integer"),
			"mtu":            typed("integer"),
		}, "name", "remoteHost", "localTunnelIp", "remoteTunnelIp", "prefix", "mtu")),
		"forwards": array(object(schema{
			"id":         typed("string"),
			"proto":      enum("udp", "tcp"),
			"listenPort": port(),
			"targetIp":   typed("string"),
			"targetPort": port(),
			"fallbackIp": nullable("string"),
			"route":      enum("auto", "tunnel", "direct"),
			"tunnel":     nullable("string"),
			"candidates": array(object(schema{
				"targetIp": typed("string"),
				"tunnel":   nullable("string"),
				"nodeId":   typed("string"),
			}, "targetIp")),
		}, "proto", "listenPort", "targetIp", "targetPort")),
	}, "version", "nodeId", "nodeName", "interfaces", "tunnels", "forwards")

	probesSchema = object(schema{
		"targets": array(object(schema{
			"nodeId": typed("string"),
			"host":   typed("string"),
		}, "nodeId", "host")),
	}, "targets")
)

// Manifest — что воркер умеет: настройки, маршруты, события.
func Manifest(version string) map[string]any {
	return map[string]any{
		"version":     version,
		"description": "WireGuard-интерфейсы, IPIP-туннели и пробросы портов узла, пробы связности",
		"configs": []any{
			map[string]any{
				"key":         "state",
				"description": "Желаемое состояние узла: интерфейсы с пирами, туннели, пробросы. Ответ — итог применения",
				"schema":      stateSchema,
			},
			map[string]any{
				"key":         "probes",
				"description": "Ноды для проверки связности (ping раз в минуту, итог — в метриках)",
				"schema":      probesSchema,
			},
		},
		"routes": []any{
			map[string]any{
				"method":      "POST",
				"path":        "/interfaces/{name}/restart",
				"description": "Перезапустить интерфейс (wg-quick down и up)",
				"response": object(schema{
					"name":   typed("string"),
					"status": enum("up"),
				}, "name", "status"),
			},
			map[string]any{
				"method":      "GET",
				"path":        "/state",
				"description": "Последний итог применения настройки state",
				"response":    stateResultSchema,
			},
		},
		"events": []any{
			map[string]any{
				"type":        "state.result",
				"description": "Итог применения изменился без новой версии настройки (повтор после ошибки, смена маршрута) или пришёл позже ответа",
				"schema":      stateResultSchema,
			},
			map[string]any{
				"type":        "route.changed",
				"description": "Пробы сменили активный маршрут пробросов (туннель ↔ напрямую, другая реплика)",
				"schema": object(schema{
					"version": typed("integer"),
					"routes":  array(routeSchema),
				}, "version", "routes"),
			},
		},
	}
}
