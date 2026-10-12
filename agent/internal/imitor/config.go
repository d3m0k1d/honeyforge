package imitor

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

type ServiceConfig struct {
	Type string `json:"type"`
	Name string `json:"name,omitempty"`
	// Level — "low" или "medium"; по умолчанию берётся из типа сервиса.
	Level string `json:"level,omitempty"`
	// Listen по умолчанию берётся из стандартного порта типа.
	Listen  string `json:"listen,omitempty"`
	TLSCert string `json:"tls_cert,omitempty"`
	TLSKey  string `json:"tls_key,omitempty"`
	// MaxConns ограничивает одновременные соединения (по умолчанию 256).
	MaxConns int `json:"max_conns,omitempty"`
	// IdleTimeout разрывает молчащие соединения (по умолчанию 30s).
	IdleTimeout  Duration `json:"idle_timeout,omitempty"`
	Delay        Duration `json:"delay,omitempty"`
	Jitter       Duration `json:"jitter,omitempty"`
	InitialDelay Duration `json:"initial_delay,omitempty"`
	// LogInput журналирует каждый входящий запрос (по умолчанию true).
	LogInput *bool `json:"log_input,omitempty"`
	// Params настраивает встроенный профиль (banner, server, hostname, ...).
	Params map[string]string `json:"params,omitempty"`
	// Greeting и Rules полностью описывают сервис типа "line" либо дополняют любой встроенный профиль: правила из конфига идут первыми.
	Greeting string `json:"greeting,omitempty"`
	Rules    []Rule `json:"rules,omitempty"`
}

type handlerOpts struct {
	idle      time.Duration
	baseDelay time.Duration
	jitter    time.Duration
	initial   time.Duration
	logInput  bool
}

func optsFrom(cfg ServiceConfig) handlerOpts {
	o := handlerOpts{idle: 30 * time.Second, logInput: true}
	if cfg.IdleTimeout > 0 {
		o.idle = cfg.IdleTimeout.Std()
	}
	o.baseDelay = cfg.Delay.Std()
	o.jitter = cfg.Jitter.Std()
	o.initial = cfg.InitialDelay.Std()
	if cfg.LogInput != nil {
		o.logInput = *cfg.LogInput
	}
	return o
}

// serviceSpec — стандартный порт и уровень сервиса плюс фабрика обработчика.
type serviceSpec struct {
	port  string
	level string
	prof  func(map[string]string) profile
	build func(cfg ServiceConfig, opts handlerOpts) (Handler, error)
}

func service(port, level string, prof func(map[string]string) profile) serviceSpec {
	return serviceSpec{
		port:  port,
		level: level,
		prof:  prof,
		build: func(cfg ServiceConfig, o handlerOpts) (Handler, error) {
			return o.newHandler(prof(cfg.Params), cfg.Rules)
		},
	}
}

// builtins — сервисы: можно добавить новый сервис одной строкой здесь.
var builtins = map[string]serviceSpec{
	// Текстовые протоколы.
	"ssh":       service(":2222", "medium", sshProfile),
	"ftp":       service(":2121", "medium", ftpProfile),
	"smtp":      service(":2525", "medium", smtpProfile),
	"telnet":    service(":2323", "medium", telnetProfile),
	"pop3":      service(":1110", "medium", pop3Profile),
	"imap":      service(":1143", "medium", imapProfile),
	"memcached": service(":11211", "low", memcachedProfile),
	"irc":       service(":6667", "medium", ircProfile),
	"nntp":      service(":119", "low", nntpProfile),
	"rsync":     service(":873", "low", rsyncProfile),
	"redis":     service(":6379", "medium", redisProfile),
	"vnc":       service(":5900", "low", vncProfile),

	// Веб-сервисы (frameHTTP, работают и поверх TLS).
	"http":          service(":8080", "medium", nginxProfile),
	"http-nginx":    service(":8080", "medium", nginxProfile),
	"nginx":         service(":8080", "medium", nginxProfile),
	"apache":        service(":8080", "medium", apacheProfile),
	"http-apache":   service(":8080", "medium", apacheProfile),
	"iis":           service(":8080", "medium", iisProfile),
	"tomcat":        service(":8080", "medium", tomcatProfile),
	"grafana":       service(":3000", "medium", grafanaProfile),
	"jenkins":       service(":8080", "medium", jenkinsProfile),
	"docker":        service(":2375", "medium", dockerProfile),
	"kubernetes":    service(":6443", "medium", kubernetesProfile),
	"elasticsearch": service(":9200", "medium", elasticsearchProfile),
	"prometheus":    service(":9090", "medium", prometheusProfile),
	"webmin":        service(":10000", "medium", webminProfile),
	"phpmyadmin":    service(":8080", "medium", phpMyAdminProfile),
	"wordpress":     service(":8080", "medium", wordpressProfile),
	"router":        service(":8081", "medium", routerProfile),
	"hikvision":     service(":8000", "medium", hikvisionProfile),

	// Бинарный протокол с собственным кодеком.
	"mysql": {port: ":3306", level: "medium", build: func(cfg ServiceConfig, o handlerOpts) (Handler, error) {
		return newMySQLHandler(o, cfg.Params), nil
	}},

	// PostgreSQL: свой бинарный протокол; на low — только баннер из профиля.
	"postgres":   postgresSpec(),
	"postgresql": postgresSpec(),
	"psql":       postgresSpec(),
}

// postgresSpec — PostgreSQL: на medium свой кодек (стартовый пакет + запрос пароля), на low баннер профиля.
func postgresSpec() serviceSpec {
	return serviceSpec{
		port:  ":5432",
		level: "medium",
		prof:  postgresProfile,
		build: func(cfg ServiceConfig, o handlerOpts) (Handler, error) {
			return newPostgresHandler(o, cfg.Params), nil
		},
	}
}

// BuiltinTypes возвращает поддерживаемые типы сервисов по алфавиту.
func BuiltinTypes() []string {
	out := make([]string, 0, len(builtins)+1)
	for k := range builtins {
		out = append(out, k)
	}
	out = append(out, "line")
	sort.Strings(out)
	return out
}

// NewService собирает сервис по конфигурации.
func NewService(cfg ServiceConfig, logger *Logger) (*Service, error) {
	typ := strings.ToLower(strings.TrimSpace(cfg.Type))
	if typ == "" {
		return nil, errors.New("service type is required")
	}
	name := cfg.Name
	if name == "" {
		name = typ
	}
	if (cfg.TLSCert == "") != (cfg.TLSKey == "") {
		return nil, errors.New("tls_cert and tls_key must be set together")
	}
	spec, known := builtins[typ]

	level := strings.ToLower(strings.TrimSpace(cfg.Level))
	if level == "" {
		level = spec.level
		if !known {
			level = "medium"
		}
	}
	if level != "low" && level != "medium" {
		return nil, fmt.Errorf("invalid level %q (want low or medium)", cfg.Level)
	}

	opts := optsFrom(cfg)
	var handler Handler
	if level == "low" {
		// Низкий уровень: только баннер, без логики и захвата учётных данных.
		greeting := cfg.Greeting
		if greeting == "" && spec.prof != nil {
			greeting = spec.prof(cfg.Params).greeting
		}
		handler = newBannerHandler(greeting, opts)
	} else {
		var err error
		handler, err = buildHandler(typ, cfg, opts)
		if err != nil {
			return nil, fmt.Errorf("service %q: %w", name, err)
		}
	}

	listen := cfg.Listen
	if listen == "" {
		listen = defaultListen(typ)
	}
	if listen == "" {
		return nil, errors.New("listen address is required")
	}
	maxConns := cfg.MaxConns
	if maxConns <= 0 {
		maxConns = 256
	}

	return &Service{
		Name:     name,
		Listen:   listen,
		Level:    level,
		Logger:   logger,
		TLSCert:  cfg.TLSCert,
		TLSKey:   cfg.TLSKey,
		MaxConns: maxConns,
		handler:  handler,
	}, nil
}

func buildHandler(typ string, cfg ServiceConfig, opts handlerOpts) (Handler, error) {
	if spec, ok := builtins[typ]; ok {
		return spec.build(cfg, opts)
	}

	if typ == "line" || len(cfg.Rules) > 0 {
		if cfg.Greeting == "" && len(cfg.Rules) == 0 {
			return nil, errors.New(`type "line" requires greeting and/or rules`)
		}
		return opts.newHandler(profile{greeting: cfg.Greeting, rules: cfg.Rules}, nil)
	}
	return nil, fmt.Errorf("unknown service type %q (known: %s)", typ, strings.Join(BuiltinTypes(), ", "))
}

func defaultListen(typ string) string {
	if spec, ok := builtins[typ]; ok {
		return spec.port
	}
	return ""
}

func param(params map[string]string, key, def string) string {
	if v, ok := params[key]; ok && v != "" {
		return v
	}
	return def
}
