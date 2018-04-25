node_modules: package.json
	npm install

webpack: src/*.js node_modules/
	./node_modules/.bin/webpack

all: node_modules webpack