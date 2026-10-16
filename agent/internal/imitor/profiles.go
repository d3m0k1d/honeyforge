package imitor

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Профили сервисов — чистые данные: приветствие, кадрирование и правила "запрос → ответ". Новый сервис — это одна запись в реестре (config.go).

func sshProfile(p map[string]string) profile {
	return profile{
		greeting: param(p, "banner", "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.6\r\n"),
		rules: []Rule{
			{Name: "client_ident", Pattern: `^(SSH-[^\r\n]+)$`, Capture: []string{"client_ident"}},
		},
	}
}

func ftpProfile(p map[string]string) profile {
	pasv := strings.ReplaceAll(param(p, "pasv_ip", "192.168.0.10"), ".", ",")
	return profile{
		greeting: param(p, "banner", "220 (vsftpd 3.0.5)\r\n"),
		rules: []Rule{
			{Name: "user", Pattern: `(?i)^USER\s+(\S+)$`, Response: "331 Please specify the password.\r\n", Capture: []string{"username"}},
			{Name: "pass", Pattern: `(?i)^PASS\s+(.*)$`, Response: "530 Login incorrect.\r\n", Capture: []string{"password"}},
			{Name: "syst", Pattern: `(?i)^SYST$`, Response: "215 UNIX Type: L8\r\n"},
			{Name: "feat", Pattern: `(?i)^FEAT$`, Response: "211-Features:\r\n EPRT\r\n EPSV\r\n MDTM\r\n PASV\r\n REST STREAM\r\n SIZE\r\n TVFS\r\n UTF8\r\n211 End\r\n"},
			{Name: "opts_utf8", Pattern: `(?i)^OPTS\s+UTF8\s+ON$`, Response: "200 Always in UTF8 mode.\r\n"},
			{Name: "pwd", Pattern: `(?i)^(PWD|XPWD)$`, Response: "257 \"/\" is the current directory\r\n"},
			{Name: "cwd", Pattern: `(?i)^CWD\s+(.*)$`, Response: "250 Directory successfully changed.\r\n", Capture: []string{"path"}},
			{Name: "type", Pattern: `(?i)^TYPE\s+([AI])$`, Response: "200 Switching to Binary mode.\r\n", Capture: []string{"type"}},
			{Name: "pasv", Pattern: `(?i)^PASV$`, Response: fmt.Sprintf("227 Entering Passive Mode (%s,239,42).\r\n", pasv)},
			{Name: "epsv", Pattern: `(?i)^EPSV$`, Response: "229 Entering Extended Passive Mode (|||6446|)\r\n"},
			{Name: "port", Pattern: `(?i)^(PORT|EPRT)\s+.*$`, Response: "200 PORT command successful. Consider using PASV.\r\n"},
			{Name: "list", Pattern: `(?i)^(LIST|NLST|MLSD)(\s+.*)?$`, Response: "150 Here comes the directory listing.\r\n226 Directory send OK.\r\n"},
			{Name: "size", Pattern: `(?i)^SIZE\s+(.*)$`, Response: "213 0\r\n", Capture: []string{"path"}},
			{Name: "mdtm", Pattern: `(?i)^MDTM\s+(.*)$`, Response: "550 Could not get file modification time.\r\n", Capture: []string{"path"}},
			{Name: "retr", Pattern: `(?i)^RETR\s+(.*)$`, Response: "550 Failed to open file.\r\n", Capture: []string{"path"}},
			{Name: "stor", Pattern: `(?i)^STOR\s+(.*)$`, Response: "550 Permission denied.\r\n", Capture: []string{"path"}},
			{Name: "noop", Pattern: `(?i)^NOOP$`, Response: "200 NOOP ok.\r\n"},
			{Name: "quit", Pattern: `(?i)^QUIT$`, Response: "221 Goodbye.\r\n", Close: true},
			{Name: "unknown", Pattern: ``, Response: "500 Command not understood.\r\n"},
		},
	}
}

func smtpProfile(p map[string]string) profile {
	host := param(p, "hostname", "mail.example.com")
	ehlo := "250-" + host + "\r\n" +
		"250-PIPELINING\r\n" +
		"250-SIZE 10240000\r\n" +
		"250-VRFY\r\n" +
		"250-ETRN\r\n" +
		"250-STARTTLS\r\n" +
		"250-ENHANCEDSTATUSCODES\r\n" +
		"250-8BITMIME\r\n" +
		"250 DSN\r\n"
	return profile{
		greeting: param(p, "banner", "220 "+host+" ESMTP Postfix (Ubuntu)\r\n"),
		rules: []Rule{
			{Name: "ehlo", Pattern: `(?i)^EHLO\s+(.*)$`, Response: ehlo, Capture: []string{"helo"}},
			{Name: "helo", Pattern: `(?i)^HELO\s+(.*)$`, Response: "250 " + host + "\r\n", Capture: []string{"helo"}},
			{Name: "mail_from", Pattern: `(?i)^MAIL\s+FROM:\s*(\S+)`, Response: "250 2.1.0 Ok\r\n", Capture: []string{"sender"}},
			{Name: "rcpt_to", Pattern: `(?i)^RCPT\s+TO:\s*(\S+)`, Response: "250 2.1.5 Ok\r\n", Capture: []string{"recipient"}},
			{Name: "data", Pattern: `(?i)^DATA$`, Response: "354 End data with <CR><LF>.<CR><LF>\r\n", SetState: "data"},
			{Name: "data_end", On: "data", Pattern: `^\.$`, Response: "250 2.0.0 Ok: queued as 7F3B91C4\r\n", ClearState: true},
			{Name: "data_body", On: "data", Pattern: ``, Response: ""},
			{Name: "auth_plain", Pattern: `(?i)^AUTH\s+PLAIN\s+(\S+)$`, Response: "535 5.7.8 Error: authentication failed:\r\n", Capture: []string{"sasl_base64"}},
			{Name: "auth_login", Pattern: `(?i)^AUTH\s+LOGIN$`, Response: "334 VXNlcm5hbWU6\r\n", SetState: "smtp_user"},
			{Name: "auth_user", On: "smtp_user", Pattern: `^(.+)$`, Response: "334 UGFzc3dvcmQ6\r\n", Capture: []string{"sasl_user_b64"}, SetState: "smtp_pass"},
			{Name: "auth_pass", On: "smtp_pass", Pattern: `^(.+)$`, Response: "535 5.7.8 Error: authentication failed:\r\n", Capture: []string{"sasl_pass_b64"}, ClearState: true},
			{Name: "noop", Pattern: `(?i)^NOOP$`, Response: "250 2.0.0 Ok\r\n"},
			{Name: "rset", Pattern: `(?i)^RSET$`, Response: "250 2.0.0 Ok\r\n"},
			{Name: "vrfy", Pattern: `(?i)^VRFY\s+.*$`, Response: "252 2.5.2 Cannot VRFY user, but will accept message and attempt delivery\r\n"},
			{Name: "starttls", Pattern: `(?i)^STARTTLS$`, Response: "454 4.7.0 TLS not available due to temporary reason\r\n"},
			{Name: "quit", Pattern: `(?i)^QUIT$`, Response: "221 2.0.0 Bye\r\n", Close: true},
			{Name: "unknown", Pattern: ``, Response: "502 5.5.2 Error: command not recognized\r\n"},
		},
	}
}

func telnetProfile(p map[string]string) profile {
	return profile{
		// IAC WILL ECHO, IAC WILL SGA, IAC DO NAWS
		connect:  []byte{255, 251, 1, 255, 251, 3, 255, 253, 31},
		greeting: param(p, "banner", "\r\nUbuntu 22.04.4 LTS\r\n\r\nlogin: "),
		stripIAC: true,
		rules: []Rule{
			{Name: "login", Pattern: `^(.+)$`, Response: "Password: ", Capture: []string{"username"}, SetState: "pass"},
			{Name: "password", On: "pass", Pattern: `^(.+)$`, Response: "Login incorrect\r\n\r\nlogin: ", Capture: []string{"password"}, ClearState: true},
			{Name: "empty", Pattern: ``, Response: "login: "},
		},
	}
}

func pop3Profile(p map[string]string) profile {
	return profile{
		greeting: param(p, "banner", "+OK Dovecot ready.\r\n"),
		rules: []Rule{
			{Name: "user", Pattern: `(?i)^USER\s+(\S+)`, Response: "+OK\r\n", Capture: []string{"username"}},
			{Name: "pass", Pattern: `(?i)^PASS\s+(\S+)`, Response: "-ERR [AUTH] Authentication failed.\r\n", Capture: []string{"password"}},
			{Name: "capa", Pattern: `(?i)^CAPA$`, Response: "+OK\r\nUSER\r\nUIDL\r\nTOP\r\nSASL PLAIN LOGIN\r\n.\r\n"},
			{Name: "stat", Pattern: `(?i)^STAT$`, Response: "+OK 0 0\r\n"},
			{Name: "list", Pattern: `(?i)^LIST`, Response: "+OK 0 messages:\r\n.\r\n"},
			{Name: "uidl", Pattern: `(?i)^UIDL`, Response: "+OK\r\n.\r\n"},
			{Name: "noop", Pattern: `(?i)^NOOP$`, Response: "+OK\r\n"},
			{Name: "quit", Pattern: `(?i)^QUIT$`, Response: "+OK Logging out.\r\n", Close: true},
			{Name: "unknown", Pattern: ``, Response: "-ERR Invalid command.\r\n"},
		},
	}
}

func imapProfile(p map[string]string) profile {
	return profile{
		greeting: param(p, "banner", "* OK [CAPABILITY IMAP4rev1 SASL-IR LOGIN-REFERRALS ID ENABLE IDLE AUTH=PLAIN] Dovecot ready.\r\n"),
		rules: []Rule{
			{Name: "capability", Pattern: `(?i)^(?P<tag>\S+)\s+CAPABILITY$`, Response: "* CAPABILITY IMAP4rev1 SASL-IR LOGIN-REFERRALS ID ENABLE IDLE AUTH=PLAIN\r\n{tag} OK Capability completed.\r\n"},
			{Name: "login", Pattern: `(?i)^(?P<tag>\S+)\s+LOGIN\s+"?(?P<username>[^"\s]+)"?\s+"?(?P<password>[^"\r\n]*)"?`, Response: "{tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n"},
			{Name: "logout", Pattern: `(?i)^(?P<tag>\S+)\s+LOGOUT`, Response: "* BYE Logging out\r\n{tag} OK Logout completed.\r\n", Close: true},
			{Name: "noop", Pattern: `(?i)^(?P<tag>\S+)\s+NOOP`, Response: "{tag} OK NOOP completed.\r\n"},
			{Name: "select", Pattern: `(?i)^(?P<tag>\S+)\s+(SELECT|EXAMINE)\s+.*`, Response: "* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n* 0 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 1] UIDs valid\r\n* OK [UIDNEXT 1] Predicted next UID\r\n{tag} OK [READ-WRITE] Select completed.\r\n"},
			{Name: "list", Pattern: `(?i)^(?P<tag>\S+)\s+(LIST|LSUB)`, Response: "* LIST (\\HasNoChildren) \"/\" \"\"\r\n{tag} OK List completed.\r\n"},
			{Name: "tagged_unknown", Pattern: `(?i)^(?P<tag>\S+)\s+`, Response: "{tag} BAD Error in IMAP command received by server.\r\n"},
			{Name: "unknown", Pattern: ``, Response: "* BAD Error in IMAP command received by server.\r\n"},
		},
	}
}

func memcachedProfile(p map[string]string) profile {
	ver := param(p, "version", "1.6.18")
	return profile{
		rules: []Rule{
			{Name: "version", Pattern: `(?i)^version$`, Response: "VERSION " + ver + "\r\n"},
			{Name: "stats", Pattern: `(?i)^stats(\s+.*)?$`, Response: memcachedStats(ver)},
			{Name: "get", Pattern: `(?i)^(get|gets)\s+.*$`, Response: "END\r\n"},
			{Name: "set", Pattern: `(?i)^(?P<cmd>set|add|replace|append|prepend)\s+(?P<key>\S+)\s+(?P<flags>\d+)\s+(?P<exptime>\d+)\s+(?P<bytes>\d+)`, SetState: "memcached_value"},
			{Name: "set_value", On: "memcached_value", Pattern: ``, Response: "STORED\r\n", ClearState: true},
			{Name: "delete", Pattern: `(?i)^delete\s+\S+`, Response: "DELETED\r\n"},
			{Name: "incr", Pattern: `(?i)^(incr|decr)\s+`, Response: "NOT_FOUND\r\n"},
			{Name: "touch", Pattern: `(?i)^touch\s+`, Response: "NOT_FOUND\r\n"},
			{Name: "flush_all", Pattern: `(?i)^flush_all`, Response: "OK\r\n"},
			{Name: "quit", Pattern: `(?i)^quit$`, Close: true},
			{Name: "unknown", Pattern: ``, Response: "ERROR\r\n"},
		},
	}
}

func memcachedStats(ver string) string {
	return "STAT pid 6859\r\n" +
		"STAT uptime 16402\r\n" +
		"STAT time 1710000000\r\n" +
		"STAT version " + ver + "\r\n" +
		"STAT libevent 2.1.12-stable\r\n" +
		"STAT pointer_size 64\r\n" +
		"STAT curr_connections 5\r\n" +
		"STAT total_connections 42\r\n" +
		"STAT cmd_get 0\r\n" +
		"STAT cmd_set 0\r\n" +
		"STAT bytes 0\r\n" +
		"STAT curr_items 0\r\n" +
		"STAT total_items 0\r\n" +
		"STAT evictions 0\r\n" +
		"END\r\n"
}

func ircProfile(p map[string]string) profile {
	host := param(p, "hostname", "irc.example.com")
	return profile{
		greeting: ":" + host + " NOTICE * :*** Looking up your hostname...\r\n",
		rules: []Rule{
			{Name: "nick", Pattern: `(?i)^NICK\s+(\S+)`, Capture: []string{"username"}},
			{Name: "user", Pattern: `(?i)^USER\s+(\S+)\s+.*`, Capture: []string{"ident"}},
			{Name: "cap", Pattern: `(?i)^CAP\s+LS.*`, Response: ":" + host + " CAP * LS :\r\n"},
			{Name: "ping", Pattern: `(?i)^PING\s+(\S+)`, Response: ":" + host + " PONG " + host + " :{token}\r\n", Capture: []string{"token"}},
			{Name: "quit", Pattern: `(?i)^QUIT`, Response: "ERROR :Closing Link: " + host + " (Quit)\r\n", Close: true},
			{Name: "unknown", Pattern: ``, Response: ":" + host + " 421 * :Unknown command\r\n"},
		},
	}
}

func nntpProfile(p map[string]string) profile {
	host := param(p, "hostname", "news.example.com")
	return profile{
		greeting: param(p, "banner", "200 "+host+" NNTP Service ready (INN 2.6.4)\r\n"),
		rules: []Rule{
			{Name: "authinfo_user", Pattern: `(?i)^AUTHINFO\s+USER\s+(\S+)`, Response: "381 Password required\r\n", Capture: []string{"username"}},
			{Name: "authinfo_pass", Pattern: `(?i)^AUTHINFO\s+PASS\s+(\S+)`, Response: "481 Authentication failed\r\n", Capture: []string{"password"}},
			{Name: "mode_reader", Pattern: `(?i)^MODE\s+READER$`, Response: "200 Posting allowed\r\n"},
			{Name: "group", Pattern: `(?i)^GROUP\s+(\S+)`, Response: "411 No such newsgroup\r\n", Capture: []string{"group"}},
			{Name: "list", Pattern: `(?i)^LIST`, Response: "215 list of newsgroups follows\r\n.\r\n"},
			{Name: "quit", Pattern: `(?i)^QUIT$`, Response: "205 Closing connection\r\n", Close: true},
			{Name: "unknown", Pattern: ``, Response: "500 Unknown command\r\n"},
		},
	}
}

func rsyncProfile(p map[string]string) profile {
	ver := param(p, "version", "31.0")
	return profile{
		greeting: "@RSYNCD: " + ver + "\n",
		rules: []Rule{
			{Name: "handshake", Pattern: `^@RSYNCD:`, Response: ""},
			{Name: "module", Pattern: `^(?P<module>\S+)$`, Response: "@ERROR: Unknown module '{module}'\n"},
			{Name: "unknown", Pattern: ``, Response: "@ERROR: protocol startup error\n"},
		},
	}
}

func vncProfile(p map[string]string) profile {
	return profile{
		greeting: param(p, "banner", "RFB 003.008\n"),
		framing:  frameRaw,
	}
}

// postgresProfile — PostgreSQL. На low lvl отдаётся только баннер-версия,
// на medium работает собственный обработчик протокола (postgresHandler).
func postgresProfile(p map[string]string) profile {
	ver := param(p, "server_version", "16.3")
	return profile{
		greeting: param(p, "banner", "PostgreSQL "+ver+" on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.2.0-23ubuntu4) 13.2.0, 64-bit\r\n"),
	}
}

// redisProfile описывает Redis на движке правил: RESP-кадрирование превращает команды в строки вида "AUTH default hunter2", которые сверяются с правилами.
func redisProfile(p map[string]string) profile {
	pass := param(p, "requirepass", "")
	rules := []Rule{
		{Name: "ping", Pattern: `(?i)^PING\b`, Response: "+PONG\r\n"},
		{Name: "quit", Pattern: `(?i)^QUIT\b`, Response: "+OK\r\n", Close: true},
		{Name: "info", Pattern: `(?i)^INFO\b`, Response: redisBulk(redisInfo)},
		{Name: "command", Pattern: `(?i)^COMMAND\b`, Response: "*0\r\n"},
		{Name: "config", Pattern: `(?i)^CONFIG\b`, Response: "*0\r\n"},
		{Name: "client", Pattern: `(?i)^CLIENT\b`, Response: "+OK\r\n"},
		{Name: "select", Pattern: `(?i)^SELECT\b`, Response: "+OK\r\n"},
		{Name: "set", Pattern: `(?i)^SET\s+(\S+)\s+(\S+)`, Response: "+OK\r\n", Capture: []string{"key", "value"}},
		{Name: "get", Pattern: `(?i)^GET\b`, Response: "$-1\r\n"},
		{Name: "del", Pattern: `(?i)^DEL\b`, Response: ":0\r\n"},
		{Name: "keys", Pattern: `(?i)^KEYS\b`, Response: "*0\r\n"},
		{Name: "flush", Pattern: `(?i)^FLUSH(ALL|DB)\b`, Response: "+OK\r\n"},
		{Name: "hello", Pattern: `(?i)^HELLO\b`, Response: "-NOPROTO unsupported protocol version\r\n"},
	}
	if pass == "" {
		rules = append(rules, Rule{
			Name:    "auth",
			Pattern: `(?i)^AUTH\s+(\S+)$`,
			Response: "-ERR AUTH <password> called without any password configured for the default user. " +
				"Are you sure your configuration is correct?\r\n",
			Capture: []string{"password"},
		})
	} else {
		quoted := regexp.QuoteMeta(pass)
		rules = append(rules,
			Rule{Name: "auth", Pattern: `(?i)^AUTH\s+(?:default\s+)?(?P<password>` + quoted + `)$`, Response: "+OK\r\n"},
			Rule{Name: "auth", Pattern: `(?i)^AUTH\s+(\S+)\s+(\S+)$`, Response: "-WRONGPASS invalid username-password pair or user is disabled.\r\n", Capture: []string{"username", "password"}},
			Rule{Name: "auth", Pattern: `(?i)^AUTH\s+(\S+)$`, Response: "-WRONGPASS invalid username-password pair or user is disabled.\r\n", Capture: []string{"password"}},
		)
	}
	// Redis отвечает ошибкой на неизвестную команду, а не молчит.
	rules = append(rules, Rule{
		Name:     "unknown",
		Pattern:  `(?s)^(.*)$`,
		Response: "-ERR unknown command '{cmd}'\r\n",
		Capture:  []string{"cmd"},
	})
	return profile{framing: frameRESP, rules: rules}
}

func redisBulk(s string) string {
	return "$" + strconv.Itoa(len(s)) + "\r\n" + s + "\r\n"
}

// redisInfo — сокращённый, но правдоподобный вывод INFO.
const redisInfo = "# Server\r\n" +
	"redis_version:7.0.14\r\n" +
	"redis_git_sha1:00000000\r\n" +
	"redis_mode:standalone\r\n" +
	"os:Linux 5.15.0-105-generic x86_64\r\n" +
	"arch_bits:64\r\n" +
	"multiplexing_api:epoll\r\n" +
	"process_id:1\r\n" +
	"run_id:6f9b2c0f4e1a4d8c9b7a3e5f1c2d4b6a8e0f1a2b\r\n" +
	"tcp_port:6379\r\n" +
	"uptime_in_seconds:48213\r\n" +
	"executable:/usr/local/bin/redis-server\r\n" +
	"config_file:/etc/redis/redis.conf\r\n" +
	"\r\n# Clients\r\n" +
	"connected_clients:2\r\n" +
	"\r\n# Memory\r\n" +
	"used_memory:1048576\r\n" +
	"used_memory_human:1.00M\r\n" +
	"maxmemory:0\r\n" +
	"maxmemory_policy:noeviction\r\n" +
	"\r\n# Stats\r\n" +
	"total_connections_received:37\r\n" +
	"total_commands_processed:128\r\n" +
	"keyspace_hits:4\r\n" +
	"keyspace_misses:12\r\n" +
	"\r\n# Replication\r\n" +
	"role:master\r\n" +
	"connected_slaves:0\r\n" +
	"\r\n# Keyspace\r\n" +
	"db0:keys=0,expires=0,avg_ttl=0\r\n"
