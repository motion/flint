clean:
	-rm -rf packages/*/lib

build: clean
	./scripts/build.sh

watch-core: clean
	scripts/build.sh --watch --notools

watch: clean
	scripts/build.sh --watch

bootstrap:
	npm install
	(cd js-deps && npm prune && npm install)
	(cd packages/client && ln -s ../../js-deps/node_modules node_modules)
	node scripts/bootstrap.js
	scripts/build.sh

ready:
	git pull --rebase

release: ready
	node scripts/release.js

patch: ready
	node scripts/release.js --patch

patch-verbose:
	node scripts/release.js --patch --verbose

patch-tools: ready
	node scripts/release.js --patch tools

patch-motion: ready
	node scripts/release.js --patch motion

patch-client: ready
	node scripts/release.js --patch client

patch-transform: ready
	node scripts/release.js --patch transform

patch-nice-styles: ready
	node scripts/release.js --patch nice-styles
