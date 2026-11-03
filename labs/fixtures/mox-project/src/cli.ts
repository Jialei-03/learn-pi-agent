const [command, ...rest] = process.argv.slice(2);
if (command === 'add') console.log('已记录：' + rest.join(' '));
else if (command === 'search') console.log('搜索：' + rest.join(' '));
else console.log('用法：mox add <内容> | mox search <关键词>');
