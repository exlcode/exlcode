FROM nginx:stable
RUN mkdir /usr/share/nginx/html/ide
COPY ./exlcode/out-build-min /usr/share/nginx/html/ide/out-build-min
COPY ./exlcode/out-build-min/index.html /usr/share/nginx/html/ide/
COPY prod-nginx.conf /etc/nginx/nginx.conf
COPY prod-nginx-site.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
