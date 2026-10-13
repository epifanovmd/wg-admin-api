package main

import (
	"encoding/json"

	"github.com/epifanovmd/agent/protocol"
)

type schema = map[string]any

var (
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

// Manifest — что воркер умеет: настройка proxies (docs/PROTOCOL.md агента, §13).
func Manifest() protocol.WorkerManifest {
	raw, _ := json.Marshal(proxiesSchema)

	return protocol.WorkerManifest{
		Description: "SOCKS5-прокси через mTLS: клиентский сертификат из списка отпечатков, логин и пароль",
		Configs: []protocol.ManifestConfig{{
			Key:         ConfigProxies,
			Description: "Прокси узла: порт, сертификаты, разрешённые отпечатки клиентов, пользователи (соль и scrypt-хэш). Прокси с ошибкой — в пульсе",
			Schema:      raw,
		}},
	}
}
