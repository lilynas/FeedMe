// RSS源接口
// name: 信息源名称
// url: RSS URL地址
// category: 分类名称

/**
 * @typedef {object} RssSource
 * @property {string} name - 信息源名称
 * @property {string} url - RSS URL地址
 * @property {string} category - 分类名称
 */

// 默认配置
export const config = {
  sources: [
    {
      name: "联合早报即时新闻",
      url: "https://rsshub.rssforever.com/zaobao/realtime/china",
      category: "新闻媒体",
    },
    {
      name: "BBC World News",
      url: "https://rsshub.rssforever.com/bbc/world-asia",
      category: "新闻媒体",
    },
    {
      name: "SCMP",
      url: "https://www.scmp.com/rss/91/feed",
      category: "新闻媒体",
    },
    {
      name: "朝鲜日报",
      url: "https://feedx.net/rss/chosun.xml",
      category: "新闻媒体",
    },
        {
      name: "纽约时报",
      url: "https://feedx.net/rss/nytimes.xml",
      category: "新闻媒体",
    },
    {
  name: "DW",
  url: "https://feedx.net/rss/dw.xml",
  category: "新闻媒体",
   },
    {
  name: "光明日报",
  url: "https://feedx.net/rss/guangmingribao.xml",
  category: "报纸摘要",
},
  ],
  maxItemsPerFeed: 30,
  dataPath: "./data",
}


export const defaultSource = config.sources[0]

/**
 * @param {string} url
 * @returns {RssSource | undefined}
 */
export function findSourceByUrl(url) {
  return config.sources.find((source) => source.url === url)
}

export function getSourcesByCategory() {
  return config.sources.reduce((acc, source) => {
    if (!acc[source.category]) {
      acc[source.category] = []
    }
    acc[source.category].push(source)
    return acc
  }, {})
}
