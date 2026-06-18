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
	@echo "  make release      - Tu dong commit, tang version (patch) va publish (Local)"
	@echo "  make patch        - Tang version patch (1.0.x), push va publish (Local)"
	@echo "  make minor        - Tang version minor (1.x.0), push va publish (Local)"
	@echo "  make major        - Tang version major (x.0.0), push va publish (Local)"
	@echo "  make ci-patch     - Tang version patch va trigger GitHub Actions (Khong build local)"
	@echo "  make ci-minor     - Tang version minor va trigger GitHub Actions (Khong build local)"
	@echo "  make ci-major     - Tang version major va trigger GitHub Actions (Khong build local)"

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

# --- Lệnh dành cho GitHub Actions CI/CD (Chỉ push, không build local) ---
ci-patch:
	git add .
	-git commit -m "chore: release patch"
	npm version patch
	git push
	git push --tags

ci-minor:
	git add .
	-git commit -m "chore: release minor"
	npm version minor
	git push
	git push --tags

ci-major:
	git add .
	-git commit -m "chore: release major"
	npm version major
	git push
	git push --tags

# Mặc định release là patch (local)
release: patch

# Lệnh một chạm update cho production
update:
	git add .
	-git commit -m "chore: update production"
	npm run release
