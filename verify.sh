#!/bin/bash
# 部署前的本地验证 + 打包
set -e

echo "=== 模型智能测试站 - 部署前验证 ==="
node -v
npm -v

npm install
npm run release

echo ""
echo "✓ 验证通过，发布包在 release/ 目录"
echo "下一步：上传 zip 到服务器解压，按 DEPLOY.md 部署"
