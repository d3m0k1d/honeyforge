package imitor

import "strconv"

// HTTP-сервисы — такие же профили, как и остальные: кадрирование frameHTTP режет поток на запросы, а правила отдают готовые ответы. Поэтому любой веб-сервис описывается данными и работает то же самое поверх TLS.
// httpResponse собирает готовый HTTP-ответ с корректным Content-Length.
// extra — дополнительные строки заголовков, например "X-Foo: bar".
func httpResponse(status int, reason, server, ctype, body string, extra ...string) string {
	h := "HTTP/1.1 " + strconv.Itoa(status) + " " + reason + "\r\n"
	if server != "" {
		h += "Server: " + server + "\r\n"
	}
	h += "Content-Type: " + ctype + "\r\n"
	h += "Content-Length: " + strconv.Itoa(len(body)) + "\r\n"
	for _, e := range extra {
		h += e + "\r\n"
	}
	h += "Connection: keep-alive\r\n\r\n"
	return h + body
}

func httpHTML(status int, reason, server, body string, extra ...string) string {
	return httpResponse(status, reason, server, "text/html; charset=utf-8", body, extra...)
}

func httpJSON(status int, reason, server, body string, extra ...string) string {
	return httpResponse(status, reason, server, "application/json", body, extra...)
}

func httpPlain(status int, reason, server, body string) string {
	return httpResponse(status, reason, server, "text/plain; charset=utf-8", body)
}

func httpRedirect(server, loc string) string {
	return httpResponse(302, "Found", server, "text/html", "", "Location: "+loc)
}

func errorPage(server, title string) string {
	return "<html>\r\n<head><title>" + title + "</title></head>\r\n<body>\r\n" +
		"<center><h1>" + title + "</h1></center>\r\n" +
		"<hr><center>" + server + "</center>\r\n</body>\r\n</html>\r\n"
}

func indexRule(server string, p map[string]string) []Rule {
	if body := param(p, "index_body", ""); body != "" {
		return []Rule{{Name: "index", Pattern: `(?i)^GET /(?:\?|\s|$)`, Response: httpHTML(200, "OK", server, body)}}
	}
	return nil
}

func nginxProfile(p map[string]string) profile {
	server := param(p, "server", "nginx/1.25.2")
	rules := indexRule(server, p)
	rules = append(rules, Rule{Name: "not_found", Pattern: ``, Response: httpHTML(404, "Not Found", server, errorPage(server, "404 Not Found"))})
	return profile{framing: frameHTTP, rules: rules}
}

func apacheProfile(p map[string]string) profile {
	server := param(p, "server", "Apache/2.4.57 (Ubuntu)")
	rules := indexRule(server, p)
	rules = append(rules, Rule{Name: "not_found", Pattern: ``, Response: httpHTML(404, "Not Found", server, errorPage(server, "404 Not Found"))})
	return profile{framing: frameHTTP, rules: rules}
}

func iisProfile(p map[string]string) profile {
	server := param(p, "server", "Microsoft-IIS/10.0")
	body := "<!DOCTYPE html>\r\n<html>\r\n<head><title>404 - File or directory not found.</title></head>\r\n" +
		"<body><h1>404 - File or directory not found.</h1><hr><p>IIS</p></body>\r\n</html>\r\n"
	rules := indexRule(server, p)
	rules = append(rules, Rule{Name: "not_found", Pattern: ``, Response: httpHTML(404, "Not Found", server, body)})
	return profile{framing: frameHTTP, rules: rules}
}

func grafanaProfile(p map[string]string) profile {
	login := loginPage("Grafana", "grafana", "Email or username", "Password")
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "health", Pattern: `(?i)^GET /api/health`, Response: httpJSON(200, "OK", "", `{"commit":"abc1234","database":"ok","version":"10.4.1"}`)},
		{Name: "login", Pattern: `(?i)^GET /login`, Response: httpHTML(200, "OK", "", login)},
		{Name: "root", Pattern: `(?i)^GET /(?:\?|\s|$)`, Response: httpRedirect("", "/login")},
		{Name: "not_found", Pattern: ``, Response: httpJSON(404, "Not Found", "", `{"message":"Not found"}`)},
	}}
}

func jenkinsProfile(p map[string]string) profile {
	server := "Jetty(10.0.20)"
	login := loginPage("Jenkins", "jenkins", "User", "Password")
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "login", Pattern: `(?i)^GET /login`, Response: httpHTML(200, "OK", server, login)},
		{Name: "root", Pattern: `(?i)^GET /(?:\?|\s|$)`, Response: httpHTML(403, "Forbidden", server, errorPage(server, "403 Forbidden"))},
		{Name: "script", Pattern: `(?i)^POST /script`, Response: httpHTML(403, "Forbidden", server, errorPage(server, "403 Forbidden"))},
		{Name: "not_found", Pattern: ``, Response: httpHTML(404, "Not Found", server, errorPage(server, "404 Not Found"))},
	}}
}

// dockerProfile повторяет открытый наружу Docker API — частую ошибку настройки.
func dockerProfile(p map[string]string) profile {
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "ping", Pattern: `(?i)^GET /_ping`, Response: httpPlain(200, "OK", "", "OK")},
		{Name: "version", Pattern: `(?i)^GET /version`, Response: httpJSON(200, "OK", "", `{"Platform":{"Name":"Docker Engine"},"Version":"25.0.3","ApiVersion":"1.44","Os":"linux","Arch":"amd64"}`)},
		{Name: "containers", Pattern: `(?i)^GET /containers/json`, Response: httpJSON(200, "OK", "", `[]`)},
		{Name: "images", Pattern: `(?i)^GET /images/json`, Response: httpJSON(200, "OK", "", `[]`)},
		{Name: "not_found", Pattern: ``, Response: httpJSON(404, "Not Found", "", `{"message":"page not found"}`)},
	}}
}

func kubernetesProfile(p map[string]string) profile {
	forbidden := `{"kind":"Status","apiVersion":"v1","status":"Failure","message":"forbidden: User \"system:anonymous\" cannot get path \"/\"","reason":"Forbidden","code":403}`
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "version", Pattern: `(?i)^GET /version`, Response: httpJSON(200, "OK", "", `{"major":"1","minor":"29","gitVersion":"v1.29.2","platform":"linux/amd64"}`)},
		{Name: "healthz", Pattern: `(?i)^GET /healthz`, Response: httpPlain(200, "OK", "", "ok")},
		{Name: "forbidden", Pattern: ``, Response: httpJSON(403, "Forbidden", "", forbidden)},
	}}
}

func elasticsearchProfile(p map[string]string) profile {
	const product = "X-Elastic-Product: Elasticsearch"
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "root", Pattern: `(?i)^GET /(?:\?|\s|$)`, Response: httpJSON(200, "OK", "", `{"name":"node-1","cluster_name":"elasticsearch","version":{"number":"8.12.2","build_flavor":"default"},"tagline":"You Know, for Search"}`, product)},
		{Name: "health", Pattern: `(?i)^GET /_cluster/health`, Response: httpJSON(200, "OK", "", `{"cluster_name":"elasticsearch","status":"green","number_of_nodes":1}`, product)},
		{Name: "cat_indices", Pattern: `(?i)^GET /_cat/indices`, Response: httpPlain(200, "OK", "", "")},
		{Name: "not_found", Pattern: ``, Response: httpJSON(404, "Not Found", "", `{"error":{"root_cause":[{"type":"index_not_found_exception"}],"status":404}}`, product)},
	}}
}

func prometheusProfile(p map[string]string) profile {
	graph := "<!DOCTYPE html><html><head><title>Prometheus Time Series Collection and Processing Server</title></head><body><div id=\"react-app\"></div></body></html>"
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "healthy", Pattern: `(?i)^GET /-/healthy`, Response: httpPlain(200, "OK", "", "Prometheus Server is Healthy.")},
		{Name: "ready", Pattern: `(?i)^GET /-/ready`, Response: httpPlain(200, "OK", "", "Prometheus Server is Ready.")},
		{Name: "graph", Pattern: `(?i)^GET /graph`, Response: httpHTML(200, "OK", "", graph)},
		{Name: "root", Pattern: `(?i)^GET /(?:\?|\s|$)`, Response: httpRedirect("", "/graph")},
		{Name: "api", Pattern: `(?i)^GET /api/v1/`, Response: httpJSON(200, "OK", "", `{"status":"success","data":{"resultType":"vector","result":[]}}`)},
		{Name: "not_found", Pattern: ``, Response: httpHTML(404, "Not Found", "", errorPage("Prometheus", "404 Not Found"))},
	}}
}

func tomcatProfile(p map[string]string) profile {
	server := "Apache-Coyote/1.1"
	auth := httpHTML(401, "Unauthorized", server, errorPage(server, "401 Unauthorized"), `WWW-Authenticate: Basic realm="Tomcat Manager Application"`)
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "manager", Pattern: `(?i)^GET /manager`, Response: auth},
		{Name: "host_manager", Pattern: `(?i)^GET /host-manager`, Response: auth},
		{Name: "not_found", Pattern: ``, Response: httpHTML(404, "Not Found", server, errorPage(server, "404 Not Found"))},
	}}
}

func webminProfile(p map[string]string) profile {
	server := param(p, "server", "MiniServ/1.1")
	login := loginPage("Webmin", "webmin", "Username", "Password")
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "login", Pattern: `(?i)^GET /session_login.cgi`, Response: httpHTML(200, "OK", server, login)},
		{Name: "root", Pattern: `(?i)^GET /(?:\?|\s|$)`, Response: httpRedirect(server, "/session_login.cgi")},
		{Name: "not_found", Pattern: ``, Response: httpHTML(404, "Not Found", server, errorPage(server, "404 Not Found"))},
	}}
}

func phpMyAdminProfile(p map[string]string) profile {
	server := "Apache/2.4.57 (Ubuntu)"
	login := loginPage("phpMyAdmin", "phpmyadmin", "Username", "Password")
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "root", Pattern: `(?i)^GET /(?:\?|\s|$)`, Response: httpHTML(200, "OK", server, login)},
		{Name: "login", Pattern: `(?i)^POST /index.php`, Response: httpHTML(200, "OK", server, login)},
		{Name: "not_found", Pattern: ``, Response: httpHTML(404, "Not Found", server, errorPage(server, "404 Not Found"))},
	}}
}

func routerProfile(p map[string]string) profile {
	server := param(p, "server", "httpd")
	login := routerLogin()
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "root", Pattern: `(?i)^GET /(?:\?|\s|$)`, Response: httpHTML(200, "OK", server, login)},
		{Name: "login", Pattern: `(?i)^POST /(?:login|login\.cgi|goform/login)`, Response: httpHTML(200, "OK", server, login)},
		{Name: "not_found", Pattern: ``, Response: httpHTML(404, "Not Found", server, errorPage(server, "404 Not Found"))},
	}}
}

func hikvisionProfile(p map[string]string) profile {
	server := "webs"
	body := "<html><head><title>Hikvision Digital Technology Co.,Ltd.</title></head>" +
		"<body><div id=\"login\"><form action=\"/ISAPI/Security/sessionLogin\"><input name=\"userName\"><input name=\"password\" type=\"password\"><button>Login</button></form></div></body></html>"
	denied := `<?xml version="1.0" encoding="UTF-8"?><ResponseStatus><statusCode>4</statusCode><statusString>Invalid Operation</statusString></ResponseStatus>`
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "root", Pattern: `(?i)^GET /(?:\?|\s|$)`, Response: httpHTML(200, "OK", server, body)},
		{Name: "session_login", Pattern: `(?i)^POST /ISAPI/Security/sessionLogin`, Response: httpResponse(401, "Unauthorized", server, "application/xml", denied)},
		{Name: "not_found", Pattern: ``, Response: httpHTML(404, "Not Found", server, errorPage(server, "404 Not Found"))},
	}}
}

func wordpressProfile(p map[string]string) profile {
	server := "Apache/2.4.57 (Ubuntu)"
	login := loginPage("Log In &lsaquo; WordPress", "wordpress", "Username or Email Address", "Password")
	return profile{framing: frameHTTP, rules: []Rule{
		{Name: "login", Pattern: `(?i)^GET /wp-login.php`, Response: httpHTML(200, "OK", server, login)},
		{Name: "root", Pattern: `(?i)^GET /(?:\?|\s|$)`, Response: httpRedirect(server, "/wp-login.php")},
		{Name: "not_found", Pattern: ``, Response: httpHTML(404, "Not Found", server, errorPage(server, "404 Not Found"))},
	}}
}

func loginPage(title, class, userLabel, passLabel string) string {
	return "<!DOCTYPE html>\r\n<html>\r\n<head><title>" + title + "</title></head>\r\n" +
		"<body class=\"" + class + "\">\r\n" +
		"<form method=\"post\" action=\"/login\">\r\n" +
		"<h1>" + title + "</h1>\r\n" +
		"<label>" + userLabel + "</label><input name=\"username\" autofocus>\r\n" +
		"<label>" + passLabel + "</label><input name=\"password\" type=\"password\">\r\n" +
		"<button type=\"submit\">Sign in</button>\r\n" +
		"</form>\r\n</body>\r\n</html>\r\n"
}

func routerLogin() string {
	return "<!DOCTYPE html>\r\n<html>\r\n<head><title>Router</title></head>\r\n<body>\r\n" +
		"<form method=\"post\" action=\"/login.cgi\">\r\n" +
		"<h2>Router Login</h2>\r\n" +
		"<input name=\"username\" placeholder=\"Username\">\r\n" +
		"<input name=\"password\" type=\"password\" placeholder=\"Password\">\r\n" +
		"<button type=\"submit\">Login</button>\r\n" +
		"</form>\r\n</body>\r\n</html>\r\n"
}
