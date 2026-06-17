# Makefile cho dự án Invoice Batch Downloader

# Đọc các biến môi trường từ file .env (nếu có)
-include .env
export

.PHONY: help publish publish-win publish-mac dist dist-win dist-mac release patch minor major

help:
	@echo "Danh sach cac lenh ho tro:"
	@echo "  make dist         - Build app (Mac & Win)"
	@echo "  make dist-win     - Build app (Windows)"
	@echo "  make dist-mac     - Build app (macOS)"
	@echo "  make publish      - Build va publish app len GitHub Releases (Mac & Win)"
	@echo "  make publish-win  - Build va publish app len GitHub Releases (Windows)"
	@echo "  make publish-mac  - Build va publish app len GitHub Releases (macOS)"
	@echo "  make release      - Tu dong commit, tang version (patch) va publish"
	@echo "  make patch        - Tang version patch (1.0.x), push va publish"
	@echo "  make minor        - Tang version minor (1.x.0), push va publish"
	@echo "  make major        - Tang version major (x.0.0), push va publish"

dist:
	npm run dist

dist-win:
	npm run dist:win

dist-mac:
	npm run dist:mac

# Lệnh chỉ chạy publish (cả 2 nền tảng)
publish:
	@echo "Dang publish phien ban moi len GitHub (Mac & Win)..."
	npm run publish

publish-win:
	@echo "Dang publish phien ban moi len GitHub (Windows)..."
	npm run publish:win

publish-mac:
	@echo "Dang publish phien ban moi len GitHub (macOS)..."
	npm run publish:mac

# Lệnh để tăng version patch, push code và publish
patch:
	git add .
	-git commit -m "chore: release patch"
	npm version patch
	git push
	git push --tags
	npm run publish

# Lệnh để tăng version minor, push code và publish
minor:
	git add .
	-git commit -m "chore: release minor"
	npm version minor
	git push
	git push --tags
	npm run publish

# Lệnh để tăng version major, push code và publish
major:
	git add .
	-git commit -m "chore: release major"
	npm version major
	git push
	git push --tags
	npm run publish

# Mặc định release là patch
release: patch
