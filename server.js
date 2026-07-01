const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// 中间件
app.use(express.json());
app.use(express.static('.')); // 提供静态文件服务

// 删除文件接口
app.post('/api/delete-files', (req, res) => {
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({
            success: false,
            message: '请提供要删除的文件列表'
        });
    }

    console.log(`收到删除请求，共 ${files.length} 个文件`);
    console.log('文件列表:', files);

    // 构建 rm 命令，每个路径用双引号包裹
    const quotedPaths = files.map(f => `"${f}"`).join(' ');
    const rmCommand = `rm ${quotedPaths}`;

    console.log('执行命令:', rmCommand);

    // 执行 rm 命令
    exec(rmCommand, (error, stdout, stderr) => {
        if (error) {
            console.error('执行 rm 失败:', error);
            console.error('stderr:', stderr);
            return res.status(500).json({
                success: false,
                message: `删除失败: ${error.message}`,
                stderr: stderr
            });
        }

        if (stderr) {
            console.warn('rm 警告:', stderr);
        }

        console.log('删除成功');
        res.json({
            success: true,
            deletedCount: files.length,
            message: `成功删除 ${files.length} 个文件`
        });
    });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 服务器已启动: http://localhost:${PORT}`);
    console.log(`📁 删除接口: POST http://localhost:${PORT}/api/delete-files`);
    console.log('⚠️  请确保有足够的权限执行 rm 命令');
});
