const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'search_history.json');

// Ensure required directory and file exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([]), 'utf8');
}

const readHistory = () => {
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[SearchHistoryService] Error reading history file:', err);
    return [];
  }
};

const writeHistory = (history) => {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('[SearchHistoryService] Error writing history file:', err);
  }
};

const normalizeEmail = (email) => {
  return (email || 'guest').toLowerCase().trim();
};

module.exports = {
  /**
   * Saves or updates a search session.
   * If a search with the same user, agent, and base prompt was created within the last 15 minutes (e.g. via Load More),
   * it updates the existing entry to merge or replace with the expanded leads.
   */
  saveSearch: ({ userEmail, agentId, agentName, prompt, results }) => {
    const email = normalizeEmail(userEmail);
    const history = readHistory();
    const cleanResults = Array.isArray(results) ? results : [];

    // Extract base prompt by removing any exclusion directives (e.g. from Load More)
    const basePrompt = String(prompt || '').split('. Discover ')[0].trim().toLowerCase();

    // Look for a matching recent search session within the last 20 minutes
    const now = new Date();
    const existingIndex = history.findIndex(item => {
      if (item.userEmail !== email || item.agentId !== agentId) return false;
      const itemBase = String(item.prompt || '').split('. Discover ')[0].trim().toLowerCase();
      if (itemBase !== basePrompt) return false;

      const itemDate = new Date(item.timestamp);
      const diffMinutes = (now - itemDate) / (1000 * 60);
      return diffMinutes <= 20;
    });

    if (existingIndex >= 0) {
      // Update existing session
      const existing = history[existingIndex];
      
      // Merge unique leads by company name or product
      const existingKeys = new Set(
        existing.results.map(r => (r['Company Name'] || r['Product'] || r['Section'] || JSON.stringify(r)).toLowerCase().trim())
      );

      const mergedResults = [...existing.results];
      cleanResults.forEach(item => {
        const key = (item['Company Name'] || item['Product'] || item['Section'] || JSON.stringify(item)).toLowerCase().trim();
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          mergedResults.push(item);
        }
      });

      existing.results = mergedResults;
      existing.resultsCount = mergedResults.length;
      existing.updatedAt = now.toISOString();
      existing.prompt = prompt; // update to latest prompt

      writeHistory(history);
      return existing;
    } else {
      // Create new search history record
      const newEntry = {
        id: `sh_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        userEmail: email,
        agentId: agentId || 'allResults',
        agentName: agentName || 'All Search Results',
        prompt: prompt || 'Untitled Search',
        resultsCount: cleanResults.length,
        results: cleanResults,
        timestamp: now.toISOString(),
        updatedAt: now.toISOString()
      };

      // Limit user's history to 100 entries
      const userSearches = history.filter(h => h.userEmail === email);
      if (userSearches.length >= 100) {
        const oldestUserSearch = userSearches[userSearches.length - 1];
        const removeIdx = history.findIndex(h => h.id === oldestUserSearch.id);
        if (removeIdx >= 0) history.splice(removeIdx, 1);
      }

      history.unshift(newEntry);
      writeHistory(history);
      return newEntry;
    }
  },

  /**
   * Retrieves all search history sessions for a specific user, sorted newest first.
   */
  getUserHistory: (userEmail) => {
    const email = normalizeEmail(userEmail);
    const history = readHistory();
    return history
      .filter(item => item.userEmail === email)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  /**
   * Retrieves a single search session by ID for a user.
   */
  getSearchById: (userEmail, id) => {
    const email = normalizeEmail(userEmail);
    const history = readHistory();
    return history.find(item => item.id === id && (item.userEmail === email || email === 'admin'));
  },

  /**
   * Deletes a single search session by ID.
   */
  deleteSearch: (userEmail, id) => {
    const email = normalizeEmail(userEmail);
    const history = readHistory();
    const index = history.findIndex(item => item.id === id && (item.userEmail === email || email === 'admin'));
    if (index === -1) return false;

    history.splice(index, 1);
    writeHistory(history);
    return true;
  },

  /**
   * Clears all search history for a user.
   */
  clearUserHistory: (userEmail) => {
    const email = normalizeEmail(userEmail);
    const history = readHistory();
    const filtered = history.filter(item => item.userEmail !== email);
    writeHistory(filtered);
    return true;
  }
};
