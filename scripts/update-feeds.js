// 命令行脚本，用于更新所有RSS源数据
// 供GitHub Actions直接调用

// 加载.env文件中的环境变量
const path = require('path');
const fs = require('fs');
const dotenvPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(dotenvPath)) {
  const dotenvContent = fs.readFileSync(dotenvPath, 'utf8');
  dotenvContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.replace(/^"|"$/g, '');
      }
      process.env[key] = value;
    }
  });
  console.log('已从.env加载环境变量');
} else {
  // 尝试加载.env.local作为后备
  const localEnvPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(localEnvPath)) {
    const dotenvContent = fs.readFileSync(localEnvPath, 'utf8');
    dotenvContent.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.replace(/^"|"$/g, '');
        }
        process.env[key] = value;
      }
    });
    console.log('已从.env.local加载环境变量');
  } else {
    console.warn('未找到.env或.env.local文件，请确保环境变量已设置');
  }
}

const Parser = require('rss-parser');
const { OpenAI } = require('openai');

// 从配置文件中导入RSS源配置
const { config } = require('../config/rss-config.js');

// RSS解析器配置
const parser = new Parser({
  customFields: {
    item: [
      ["content:encoded", "content"],
      ["dc:creator", "creator"],
    ],
  },
});

// 从环境变量中获取API配置
const OPENAI_API_KEY = process.env.LLM_API_KEY;
const OPENAI_API_BASE = process.env.LLM_API_BASE;
const OPENAI_MODEL_NAME = process.env.LLM_NAME;

// 验证必要的环境变量
if (!OPENAI_API_KEY) {
  console.error('环境变量LLM_API_KEY未设置，无法生成摘要');
  process.exit(1);
}

if (!OPENAI_API_BASE) {
  console.error('环境变量LLM_API_BASE未设置，无法生成摘要');
  process.exit(1);
}

if (!OPENAI_MODEL_NAME) {
  console.error('环境变量LLM_NAME未设置，无法生成摘要');
  process.exit(1);
}

// 创建OpenAI客户端
const openai = new OpenAI({
  baseURL: OPENAI_API_BASE,
  apiKey: OPENAI_API_KEY,
});

// 确保数据目录存在
function ensureDataDir() {
  const dataDir = path.join(process.cwd(), config.dataPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

// 获取源的文件路径
function getSourceFilePath(sourceUrl) {
  const dataDir = ensureDataDir();
  // 使用URL的Base64编码作为文件名，避免非法字符
  const sourceHash = Buffer.from(sourceUrl).toString('base64').replace(/[/+=]/g, '_');
  return path.join(dataDir, `${sourceHash}.json`);
}

// 保存源数据到文件
async function saveFeedData(sourceUrl, data) {
  const filePath = getSourceFilePath(sourceUrl);

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`保存数据 ${sourceUrl} 到 ${filePath}`);
  } catch (error) {
    console.error(`保存数据 ${sourceUrl} 时出错:`, error);
    throw new Error(`保存源数据失败: ${error.message}`);
  }
}

// 从文件加载源数据
function loadFeedData(sourceUrl) {
  const filePath = getSourceFilePath(sourceUrl);

  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`加载数据 ${sourceUrl} 时出错:`, error);
    return null;
  }
}

// 生成摘要函数
async function generateSummary(title, content) {
  try {
    // 清理内容 - 移除HTML标签
    const cleanContent = content.replace(/<[^>]*>?/gm, "");

    // 准备提示词
    const prompt = `
你是一个专业的内容摘要生成器。请根据以下文章标题和内容，生成一个简洁、准确的中文摘要。
摘要应该：

1.  **主要内容概括：** 用简洁的语言（建议2句话或50字左右）清晰概括这篇新闻报道的核心事件、基本事实。
2.  **精华信息提炼：** 提取并列出2个最重要的精华信息点。这些信息点应体现新闻的核心价值、关键影响或最值得关注的结论。
3.  **信息影响分析 (一般)：** 简要分析此新闻事件可能带来的1-2个主要宏观影响或潜在后果（不含具体市场）。
4.  **市场影响评估：** 基于新闻内容，评估此信息对全球主要市场（含股票、期货、贵金属）可能产生的短期影响，并统一使用提供的评级（“重大利好”、“利好”、”无影响“、“利空”、“重大利空”）进行评述，并使用括号在括号内简要说明评级理由，评级为无影响的则不进行说明。
5.  **整体篇幅控制：** 请确保整体总结精炼，总字数尽量控制在250字以内。
6.  **附加要求：** 请将精华信息点和市场影响评估以无序列表的形式呈现。

示例：
这篇报道聚焦于中国工厂通过TikTok等社交平台向美国消费者展示“直销”模式，试图绕过关税和中间商，塑造积极形象。美国年轻人对中国的看法正逐渐转变，社交媒体成为两国民众交流和影响舆论的重要渠道。
---
一、 重要信息点：
1.中国工厂利用TikTok等平台进行直销，试图缓解关税带来的商品涨价压力。
2.美国年轻人对中国的认知逐步转变，社交媒体成为两国民众互动和理解的桥梁。

二、信息影响分析：
1.这种“TikTok外交”可能促进中美民间交流，减缓政治紧张，影响未来的公众舆论。
2.社交媒体上的正面宣传可能增强中国在年轻一代中的形象，推动两国关系的微妙变化。

三、市场短期影响：
1.该事件将对中国股票市场将产生利好（提升产品出口市场）
2.对美国股票市场则为利空（挫伤美国关税政策）。
---

文章标题：${title}

文章内容：
${cleanContent.slice(0, 20000)} // 限制内容长度以避免超出token限制
`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL_NAME,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    return completion.choices[0].message.content?.trim() || "无法生成摘要。";
  } catch (error) {
    console.error("生成摘要时出错:", error);
    return "无法生成摘要。AI 模型暂时不可用。";
  }
}

// 获取RSS源
async function fetchRssFeed(url) {
  try {
    // 直接解析RSS URL
    const feed = await parser.parseURL(url);

    // 处理items，确保所有对象都是可序列化的纯对象
    const serializedItems = feed.items.map(item => {
      // 创建新的纯对象
      const serializedItem = {
        title: item.title || "",
        link: item.link || "",
        pubDate: item.pubDate || "",
        isoDate: item.isoDate || "",
        content: item.content || "",
        contentSnippet: item.contentSnippet || "",
        creator: item.creator || "",
      };
      
      // 如果存在enclosure，以纯对象形式添加
      if (item.enclosure) {
        serializedItem.enclosure = {
          url: item.enclosure.url || "",
          type: item.enclosure.type || "",
        };
      }
      
      return serializedItem;
    });

    return {
      title: feed.title || "",
      description: feed.description || "",
      link: feed.link || "",
      items: serializedItems,
    };
  } catch (error) {
    console.error("获取RSS源时出错:", error);
    throw new Error(`获取RSS源失败: ${error.message}`);
  }
}

// 合并新旧数据，并找出需要生成摘要的新条目
function mergeFeedItems(oldItems = [], newItems = [], maxItems = config.maxItemsPerFeed) {
  // 创建一个Map来存储所有条目，使用链接作为键
  const itemsMap = new Map();

  // 添加旧条目到Map
  for (const item of oldItems) {
    if (item.link) {
      itemsMap.set(item.link, item);
    }
  }

  // 识别需要生成摘要的新条目
  const newItemsForSummary = [];

  // 添加新条目到Map，并标记需要生成摘要的条目
  for (const item of newItems) {
    if (item.link) {
      const existingItem = itemsMap.get(item.link);

      if (!existingItem) {
        // 这是一个新条目，需要生成摘要
        newItemsForSummary.push(item);
      }

      // 无论如何都更新Map，使用新条目（但保留旧摘要如果有的话）
      const serializedItem = {
        ...item,
        summary: existingItem?.summary || item.summary,
      };
      
      itemsMap.set(item.link, serializedItem);
    }
  }

  // 将Map转换回数组，保持原始RSS源的顺序
  // 使用newItems的顺序作为基准
  const mergedItems = newItems
    .filter(item => item.link && itemsMap.has(item.link))
    .map(item => item.link ? itemsMap.get(item.link) : item)
    .slice(0, maxItems); // 只保留指定数量的条目

  return { mergedItems, newItemsForSummary };
}

// 更新单个源
async function updateFeed(sourceUrl) {
  console.log(`更新源: ${sourceUrl}`);

  try {
    // 获取现有数据
    const existingData = loadFeedData(sourceUrl);

    // 获取新数据
    const newFeed = await fetchRssFeed(sourceUrl);

    // 合并数据，找出需要生成摘要的新条目
    const { mergedItems, newItemsForSummary } = mergeFeedItems(
      existingData?.items || [],
      newFeed.items,
      config.maxItemsPerFeed,
    );

    console.log(`发现 ${newItemsForSummary.length} 条新条目，来自 ${sourceUrl}`);

    // 为新条目生成摘要
    const itemsWithSummaries = await Promise.all(
      mergedItems.map(async (item) => {
        // 如果是新条目且需要生成摘要
        if (newItemsForSummary.some((newItem) => newItem.link === item.link) && !item.summary) {
          try {
            const summary = await generateSummary(item.title, item.content || item.contentSnippet || "");
            return { ...item, summary };
          } catch (err) {
            console.error(`为条目 ${item.title} 生成摘要时出错:`, err);
            return { ...item, summary: "无法生成摘要。" };
          }
        }
        // 否则保持不变
        return item;
      }),
    );

    // 创建新的数据对象
    const updatedData = {
      sourceUrl,
      title: newFeed.title,
      description: newFeed.description,
      link: newFeed.link,
      items: itemsWithSummaries,
      lastUpdated: new Date().toISOString(),
    };

    // 保存到文件
    await saveFeedData(sourceUrl, updatedData);

    return updatedData;
  } catch (error) {
    console.error(`更新源 ${sourceUrl} 时出错:`, error);
    throw new Error(`更新源失败: ${error.message}`);
  }
}

// 更新所有源
async function updateAllFeeds() {
  console.log("开始更新所有RSS源");

  const results = {};

  for (const source of config.sources) {
    try {
      await updateFeed(source.url);
      results[source.url] = true;
    } catch (error) {
      console.error(`更新 ${source.url} 失败:`, error);
      results[source.url] = false;
    }
  }

  console.log("所有RSS源更新完成");
  return results;
}

// 主函数
async function main() {
  try {
    await updateAllFeeds();
    console.log("RSS数据更新成功");
    process.exit(0);
  } catch (error) {
    console.error("RSS数据更新失败:", error);
    process.exit(1);
  }
}

// 执行主函数
main(); 
