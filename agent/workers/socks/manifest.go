package main

type schema = map[string]any

var (
	proxyStatusSchema = schema{
		"type": "object",
		"properties": schema{
			"id":         schema{"type": "string"},
			"listenPort": schema{"type": "integer"},
			"status":     schema{"type": "string", "enum": []string{"listening", "error"}},
			"message":    schema{"type": "string"},
		},
		"required": []string{"id", "listenPort", "status"},
	}

	proxiesSchema = schema{
		"type": "object",
		"properties": schema{
			"proxies": schema{
				"type": "array",
				"items": schema{
					"type": "object",
					"properties": schema{
						"id":                  schema{"type": "string"},
						"listenPort":          schema{"type": "integer", "minimum": 1, "maximum": 65535},
						"certPem":             schema{"type": "string"},
						"keyPem":              schema{"type": "string"},
						"caPem":               schema{"type": "string"},
						"allowedFingerprints": schema{"type": "array", "items": schema{"type": "string"}},
						"users": schema{
							"type": "array",
							"items": schema{
								"type": "object",
								"properties": schema{
									"username": schema{"type": "string"},
									"salt":     schema{"type": "string"},
									"hash":     schema{"type": "string"},
								},
								"required": []string{"username", "salt", "hash"},
							},
						},
					},
					"required": []string{"id", "listenPort", "certPem", "keyPem", "caPem", "allowedFingerprints", "users"},
				},
			},
		},
		"required": []string{"proxies"},
	}
)

// Manifest — что воркер умеет: настройка proxies и маршрут GET /proxies.
func Manifest(version string) map[string]any {
	return map[string]any{
		"version":     version,
		"description": "SOCKS5-прокси через mTLS: клиентский сертификат из списка отпечатков, логин и пароль",
		"configs": []any{
			map[string]any{
				"key":         "proxies",
				"description": "Прокси узла: порт, сертификаты, разрешённые отпечатки клиентов, пользователи (соль и scrypt-хэш). Ответ — статус каждого прокси",
				"schema":      proxiesSchema,
			},
		},
		"routes": []any{
			map[string]any{
				"method":      "GET",
				"path":        "/proxies",
				"description": "Статусы прокси последнего применения",
				"response": schema{
					"type":       "object",
					"properties": schema{"proxies": schema{"type": "array", "items": proxyStatusSchema}},
					"required":   []string{"proxies"},
				},
			},
		},
		"events": []any{},
	}
}
