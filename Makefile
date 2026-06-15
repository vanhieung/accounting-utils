# Makefile cho dự án Invoice Batch Downloader

# Đọc các biến môi trường từ file .env (nếu có)
-include .env
export

.PHONY: help publish release patch minor major

help:
	@echo "Danh sach cac lenh ho tro:"
	@echo "  make publish      - Build va publish app len GitHub Releases"
	@echo "  make release      - Tu dong commit, tang version (patch) va publish"
	@echo "  make patch        - Tang version patch (1.0.x), push va publish"
	@echo "  make minor        - Tang version minor (1.x.0), push va publish"
	@echo "  make major        - Tang version major (x.0.0), push va publish"

# Lệnh chỉ chạy publish
publish:
	@echo "Dang publish phien ban moi len GitHub..."
	npm run publish

# Lệnh để tăng version patch, push code và publish
patch:
	git add .
	git commit -m "chore: release patch"
	npm version patch
	git push
	git push --tags
	npm run publish

# Lệnh để tăng version minor, push code và publish
minor:
	git add .
	git commit -m "chore: release minor" || true
	npm version minor
	git push
	git push --tags
	npm run publish

# Lệnh để tăng version major, push code và publish
major:
	git add .
	git commit -m "chore: release major" || true
	npm version major
	git push
	git push --tags
	npm run publish

# Mặc định release là patch
release: patch
