Запуск:

cd control-plane/frontend <br>
docker build -t honeypotforge-frontend . <br>
docker run -d --name honeypotforge-frontend -p 3000:3000 honeypotforge-frontend <br>
