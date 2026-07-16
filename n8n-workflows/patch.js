const fs = require('fs');

const files = [
  'Lead_Discovery.json',
  'Customer_Research.json',
  'Meeting_Preparation.json',
  'Product_Recommendations.json'
];

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  
  let data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let modified = false;

  data.nodes = data.nodes.map(node => {
    // Fix Apify Node empty key issue
    if (node.name && node.name.includes('Apify') && node.parameters && node.parameters.jsonBody) {
      if (node.parameters.jsonBody.includes("$fromAI('query')")) {
        node.parameters.jsonBody = node.parameters.jsonBody.replace(
          "$fromAI('query')", 
          "$fromAI('query', 'The search query string')"
        );
        modified = true;
      }
    }
    
    // Replace SerpAPI node with HTTP Request Tool
    if (node.type === '@n8n/n8n-nodes-langchain.toolSerpApi') {
      modified = true;
      return {
        "parameters": {
          "name": "google_search",
          "description": "General Google Web Search. Use this to find companies, reviews, phone numbers, and news.",
          "method": "GET",
          "url": "https://serpapi.com/search",
          "sendQuery": true,
          "queryParameters": {
            "parameters": [
              {
                "name": "q",
                "value": "={{ $fromAI('query', 'The exact search query') }}"
              },
              {
                "name": "api_key",
                "value": "YOUR_SERPAPI_KEY_HERE"
              }
            ]
          }
        },
        "id": node.id,
        "name": "SerpAPI Google Search",
        "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
        "typeVersion": 1.1,
        "position": node.position
      };
    }
    
    return node;
  });

  if (modified) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`Updated ${file}`);
  }
});
