# 打标数据审核网页端

## 功能
- 上传 Excel/CSV 文件并读取商品数据
- 展示表头和表格数据，分页（每页 100 条）
- 显示总商品数量
- 自动将 `jfs/...` 图片路径拼接为完整 URL 进行缩略图预览
- 对每条数据进行审核标记与备注填写
- 将审核状态与备注持久化到后端
- 导出“原始表格 + 审核结果 + 备注”CSV

## 启动
```bash
cd review-web
npm start
```

打开：`http://localhost:3000`

## 注意
- Excel/CSV 解析在浏览器端完成（使用 SheetJS CDN）。
- 后端会将会话数据保存到 `data/sessions`。
