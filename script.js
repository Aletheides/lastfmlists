// Global variables
let allTracks = [];
let lastfmData = [];
let artistsData = []; // [{ name, listeners, playcount, debutYear }]
let albumsData = [];  // [{ title, artist, releaseDate, playcount }]
let tracksData = [];  // [{ title, album, listeners, playcount }]
let artistDataMap = {};
let albumDataMap = {};
let trackDataMap = {};
let topArtists = [];
let topAlbums = [];
let topTracks = [];
let activeFilters = [];
const DB_NAME = 'lastfmDataDB';
const DB_VERSION = 1;
const STORE_NAME = 'userData';
const API_KEY = "edbd779d54b373b8710af5c346148ae3";
const resultsDiv = document.getElementById("results");
const loadingDiv = document.getElementById("loading-stats");
let artistLimit = 250;
let albumLimit = 500;
let trackLimit = 1000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to merge new data into an existing array by matching a key
function mergeData(existingArray = [], newData, keyFn) {
    if (!Array.isArray(existingArray)) {
        existingArray = [];
    }

    const existingMap = new Map(
        existingArray.map(item => [keyFn(item), item])
    );

    newData.forEach(newItem => {
        const key = keyFn(newItem);
        const existingItem = existingMap.get(key);

        if (existingItem) {
            // Preserve existing properties and add new ones
            Object.entries(newItem).forEach(([prop, value]) => {
                if (value !== undefined && value !== null) {
                    existingItem[prop] = value;
                }
            });
        } else {
            existingArray.push(newItem);
        }
    });

    return existingArray;
}

function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = (event) => {
        console.error('IndexedDB open error', event);
        reject(event);
      };
      request.onsuccess = (event) => {
        const db = event.target.result;
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'username' });
        }
      };
    });
}
  
function saveUserData(username, data) {
    return openDatabase().then(db => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({ username, data, timestamp: Date.now() });
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event);
      });
    });
}
  
function getUserData(username) {
    return openDatabase().then(db => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(username);
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event);
      });
    });
}

document.getElementById("save-data").addEventListener("click", async () => {
    const username = document.getElementById("username").value.trim();
    const dataToSave = {
      allTracks,
      artistsData,
      albumsData,
      tracksData
    };
    try {
      await saveUserData(username, dataToSave);
      alert("Data saved to browser successfully!");
    } catch (err) {
      console.error("Error saving data", err);
      alert("Failed to save data.");
    }
  });
  
async function fetchListeningHistory(username) {
	const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${username}&api_key=${API_KEY}&format=json&extended=1&limit=200&autocorrect=0`;

	// Get the timezone offset (in hours) in UTC
    const timezoneOffset = new Date().getTimezoneOffset() * 60000; // in milliseconds

	// First request to get total pages
	const firstResponse = await fetch(baseUrl);
	const firstData = await firstResponse.json();

	// ** Debugging: Log the full response **
	console.log("API Response:", firstData);

	// Ensure recenttracks and track are present
	if (!firstData.recenttracks || !Array.isArray(firstData.recenttracks.track)) {
		console.error("Error: No tracks found in the first response.");
		return [];
	}

	const totalPages = parseInt(firstData.recenttracks["@attr"].totalPages, 10) || 1;
	console.log(`Total Pages: ${totalPages}`);

	// Process the first page of data
	let lastfmData = firstData.recenttracks.track.map((track) => {
		const timestamp = track.date?.uts ? parseInt(track.date.uts) : null;
		let adjustedDate = "";

		// Adjust the date based on the timezone offset
		if (timestamp) {
            adjustedDate = (timestamp * 1000 - timezoneOffset).toString();
		}

		return {
			Artist: track.artist?.name || track.artist?.["#text"] || "Unknown", // Handle both name and #text
			Album: track.album?.["#text"] || "Unknown",
			Track: track.name || "Unknown",
			Date: adjustedDate
		};
	});

    loadingDiv.innerHTML = `<p>Loading data... Page 1 of ${totalPages}</p>`;

	// Fetch and process remaining pages
	for (let page = 2; page <= totalPages; page++) {
		const response = await fetch(`${baseUrl}&page=${page}`);
		const data = await response.json();

		// ** Debugging: Log the full response for each page **
		console.log(`API Response for Page ${page}:`, data);

		// Ensure the track data is present
		if (data.recenttracks && Array.isArray(data.recenttracks.track)) {
			// Process the tracks for the current page and append to lastfmData
			lastfmData = lastfmData.concat(data.recenttracks.track.map((track) => {
				const timestamp = track.date?.uts ? parseInt(track.date.uts) : null;
				let adjustedDate = "";

				// Adjust the date based on the timezone offset
				if (timestamp) {
                    adjustedDate = (timestamp * 1000 - timezoneOffset).toString();
				}

				return {
					Artist: track.artist?.name || track.artist?.["#text"] || "Unknown",
					Album: track.album?.["#text"] || "Unknown",
					Track: track.name || "Unknown",
					Date: adjustedDate 
				};
			}));
			console.log(`Fetched Page ${page}, Total Tracks: ${lastfmData.length}`);
            loadingDiv.innerHTML = `<p>Loading data... Page ${page} of ${totalPages}</p>`;
		} else {
			console.warn(`Skipping Page ${page} due to missing track data.`);
		}
	}

	console.log(`Fetched ${lastfmData.length} total tracks.`);
	return lastfmData;
}

async function fetchRecentTracksSince(username, latestTimestamp) {
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${username}&api_key=${API_KEY}&format=json&extended=1&limit=200&autocorrect=0`;
    let newTracks = [];
    let page = 1;
    let totalPages = 1;
    let keepFetching = true;
  
    while (keepFetching && page <= totalPages) {
      const response = await fetch(`${baseUrl}&page=${page}`);
      const data = await response.json();
  
      if (!data.recenttracks || !Array.isArray(data.recenttracks.track)) {
        console.error(`No tracks found on page ${page}.`);
        break;
      }
  
      // On the first page, determine the total number of pages.
      if (page === 1 && data.recenttracks['@attr'] && data.recenttracks['@attr'].totalPages) {
        totalPages = parseInt(data.recenttracks['@attr'].totalPages, 10);
      }
  
      // Process each track on this page.
      for (const track of data.recenttracks.track) {
        // Some tracks (e.g., currently playing) might not have a date.
        if (!track.date || !track.date.uts) continue;
  
        // Convert Last.fm's uts (seconds) to a JavaScript timestamp (ms)
        const ts = parseInt(track.date.uts, 10) * 1000;
        // Adjust by timezone offset (milliseconds)
        adjustedTimestamp = (ts - new Date().getTimezoneOffset() * 60000).toString();
  
        // If the track is newer than latestTimestamp, include it.
        if (adjustedTimestamp > latestTimestamp) {
          newTracks.push({
            Artist: track.artist?.name || track.artist?.["#text"] || "Unknown",
            Album: track.album?.["#text"] || "Unknown",
            Track: track.name || "Unknown",
            Date: adjustedTimestamp.toString()
          });
        } else {
          // We've reached tracks older than our saved latest timestamp; stop processing.
          keepFetching = false;
          break;
        }
      }
      page++;
    }
  
    console.log(`Fetched ${newTracks.length} new tracks since timestamp ${latestTimestamp}`);
    return newTracks;
  }

// Fetch the user's top artists from Last.fm
async function fetchTopArtists(username) {
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${username}&api_key=${API_KEY}&format=json&limit=200&autocorrect=0`;
    
    try {
      // Fetch the first page
      const firstResponse = await fetch(baseUrl);
      const firstData = await firstResponse.json();
      
      if (!firstData.topartists || !firstData.topartists.artist) {
        console.warn("No top artists found for user:", username);
        return [];
      }
      
      // Determine total pages from the @attr property
      const totalPages = parseInt(firstData.topartists['@attr'].totalPages, 10) || 1;
      
      // Start with the artists from the first page
      let allArtists = firstData.topartists.artist;
      
      // If more than one page, fetch the rest in parallel
      if (totalPages > 1) {
        const requests = [];
        for (let page = 2; page <= totalPages; page++) {
          requests.push(
            fetch(`${baseUrl}&page=${page}`).then(response => response.json())
          );
        }
        
        const pagesData = await Promise.all(requests);
        pagesData.forEach(pageData => {
          if (pageData.topartists && pageData.topartists.artist) {
            allArtists = allArtists.concat(pageData.topartists.artist);
          }
        });
      }
      
      // Optionally, you can update progress messages here if needed.
      return allArtists.map(artist => ({ 
        name: artist.name,
        user_scrobbles: parseInt(artist.playcount, 10)
       }));
    } catch (error) {
      console.error("Error fetching top artists:", error);
      return [];
    }
  }  

async function fetchArtistDetails(artistName) {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${API_KEY}&format=json&autocorrect=0`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.artist || !data.artist.stats) {
            console.warn("No details found for artist:", artistName);
            return null;
        }

        // Update progress display if desired:
        loadingDiv.innerHTML = `<p>Loading data... Artist: ${artistName}</p>`;

        // Extract tags; ensure it's always an array of lowercased strings.
        let tags = [];
        if (data.artist.tags && data.artist.tags.tag) {
            if (Array.isArray(data.artist.tags.tag)) {
                tags = data.artist.tags.tag.map(t => t.name.toLowerCase());
            } else if (data.artist.tags.tag.name) {
                tags = [data.artist.tags.tag.name.toLowerCase()];
            }
        }

        return {
            name: data.artist.name,
            listeners: parseInt(data.artist.stats.listeners, 10),
            playcount: parseInt(data.artist.stats.playcount, 10),
            tags: tags, // Array of lowercase tag strings
        };
    } catch (error) {
        console.error("Error fetching artist details:", error);
        return null;
    }
}

async function fetchAllArtistDetails(artists, limit) {
    const results = [];
    // Limit to the top 250 artists (or whichever number you choose)
    const limitedArtists = artists.slice(0, limit);
    
    for (const artist of limitedArtists) {
      const details = await fetchArtistDetails(artist.name);
      results.push(details);
    }
    
    // Remove any null results
    return results.filter(result => result !== null);
}
  
// Fetch the user's top albums from Last.fm
async function fetchTopAlbums(username) {
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getTopAlbums&api_key=${API_KEY}&user=${encodeURIComponent(username)}&limit=200&format=json&autocorrect=0`;
  
    try {
      // Fetch the first page
      const firstResponse = await fetch(baseUrl);
      const firstData = await firstResponse.json();
  
      if (firstData.topalbums && firstData.topalbums.album) {
        // Optionally update progress display
        const totalAlbums = parseInt(firstData.topalbums['@attr'].total, 10) || firstData.topalbums.album.length;
        // For progress, you can display a message for the first page
        loadingDiv.innerHTML = `<p>Loading data... Album 1 of ${totalAlbums}</p>`;
  
        // Start with the albums from the first page.
        let allAlbums = firstData.topalbums.album;
  
        // Determine total pages
        const totalPages = parseInt(firstData.topalbums['@attr'].totalPages, 10) || 1;
        
        // If more than one page, fetch the rest in parallel.
        if (totalPages > 1) {
          const requests = [];
          for (let page = 2; page <= totalPages; page++) {
            requests.push(
              fetch(`${baseUrl}&page=${page}`).then(response => response.json())
            );
          }
          const pagesData = await Promise.all(requests);
          pagesData.forEach((pageData, idx) => {
            if (pageData.topalbums && pageData.topalbums.album) {
              // Optionally update progress display:
              loadingDiv.innerHTML = `<p>Loading data... Album ${idx + 2} of ${totalAlbums}</p>`;
              allAlbums = allAlbums.concat(pageData.topalbums.album);
            }
          });
        }
        
        // Map the albums to the required format.
        return allAlbums.map(album => ({
          name: album.name,
          artist: album.artist.name,
          user_scrobbles: parseInt(album.playcount, 10)
        }));
      } else {
        console.warn("No top albums found for user:", username);
        return [];
      }
    } catch (error) {
      console.error(`Error fetching top albums for ${username}:`, error);
      return [];
    }
}
  
// Fetch detailed album info for each album
async function fetchAlbumDetails(album) {
    const url = `https://ws.audioscrobbler.com/2.0/?method=album.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.name)}&format=json&autocorrect=0`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.album) {

            loadingDiv.innerHTML = `<p>Loading data... Album: ${album.name}</p>`;

            return {
                name: album.name,
                artist: album.artist,
                listeners: parseInt(data.album.listeners, 10) || 0,
                playcount: parseInt(data.album.playcount, 10) || 0,
            };
        } else {
            console.warn("No details found for album:", album.name);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching details for album ${album.name} by ${album.artist}:`, error);
        return null;
    }
}

async function fetchAllAlbumDetails(albums, limit) {
    const results = [];
    // Limit to the top 500 albums (or whichever number you choose)
    const limitedAlbums = albums.slice(0, limit);
    
    for (const album of limitedAlbums) {
      const details = await fetchAlbumDetails(album);
      results.push(details);
    }
    
    return results.filter(result => result !== null);
}
  
// Fetch the user's top tracks from Last.fm
async function fetchTopTracks(username) {
    const baseUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getTopTracks&api_key=${API_KEY}&user=${encodeURIComponent(username)}&limit=200&format=json&autocorrect=0`;
  
    try {
      // Fetch the first page
      const firstResponse = await fetch(baseUrl);
      const firstData = await firstResponse.json();
  
      if (firstData.toptracks && firstData.toptracks.track) {
        // Optionally update progress display
        const totalTracks = parseInt(firstData.toptracks['@attr'].total, 10) || firstData.toptracks.track.length;
        loadingDiv.innerHTML = `<p>Loading data... Track 1 of ${totalTracks}</p>`;
  
        // Start with the tracks from the first page.
        let allTracksFetched = firstData.toptracks.track;
  
        // Determine total pages
        const totalPages = parseInt(firstData.toptracks['@attr'].totalPages, 10) || 1;
        
        // If more than one page, fetch the rest in parallel.
        if (totalPages > 1) {
          const requests = [];
          for (let page = 2; page <= totalPages; page++) {
            requests.push(
              fetch(`${baseUrl}&page=${page}`).then(response => response.json())
            );
          }
          const pagesData = await Promise.all(requests);
          pagesData.forEach((pageData, idx) => {
            if (pageData.toptracks && pageData.toptracks.track) {
              loadingDiv.innerHTML = `<p>Loading data... Track ${idx + 2} of ${totalTracks}</p>`;
              allTracksFetched = allTracksFetched.concat(pageData.toptracks.track);
            }
          });
        }
        
        // Map the tracks to the required format.
        return allTracksFetched.map(track => ({
          name: track.name,
          artist: track.artist.name,
          user_scrobbles: parseInt(track.playcount, 10)
        }));
      } else {
        console.warn("No top tracks found for user:", username);
        return [];
      }
    } catch (error) {
      console.error(`Error fetching top tracks for ${username}:`, error);
      return [];
    }
}
  
// Fetch detailed track info for each track
async function fetchTrackDetails(track) {
	const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${API_KEY}&artist=${encodeURIComponent(track.artist)}&track=${encodeURIComponent(track.name)}&format=json&autocorrect=0`;

	let attempts = 0;
	while (attempts < 2) {
		try {
			const response = await fetch(url);
			const data = await response.json();

			// Rate limit detection (Last.fm sometimes returns errors when limited)
			if (data.error && data.error === 29) {
				console.warn(`Rate limit hit for track: ${track.name}. Retrying in 500ms...`);
				await new Promise((resolve) => setTimeout(resolve, 500)); // Properly wait before retrying
				attempts++;
				continue; // Retry after delay
			}

			// Check if the response has valid track data.
			if (data.track && data.track.name) {
				if (typeof loadingDiv !== "undefined" && loadingDiv) {
					loadingDiv.innerHTML = `<p>Loading data... Track: ${track.name}</p>`;
				}
				return {
					name: data.track.name,
					artist: data.track.artist?.name || track.artist,
					album: data.track.album?.title || "Unknown",
					duration: parseInt(data.track.duration, 10) || 0,
					listeners: parseInt(data.track.listeners, 10) || 0,
					playcount: parseInt(data.track.playcount, 10) || 0,
				};
			} else {
				console.warn("No details found for track:", track.name);
				return {
					name: "Unknown",
					artist: "Unknown",
					album: "Unknown",
					duration: 0,
					listeners: 0,
					playcount: 0,
				};
			}
		} catch (error) {
			console.error(`Error fetching details for track ${track.name} by ${track.artist}:`, error);
			if (attempts === 0) {
				console.warn(`Retrying fetch for ${track.name} in 500ms...`);
				await new Promise((resolve) => setTimeout(resolve, 500)); // Proper wait
			} else {
				console.warn(`Skipping track ${track.name} after multiple failures.`);
				return null;
			}
		}
		attempts++;
	}
	return null; // Fallback return in case of failure
}

async function fetchAllTrackDetails(tracks, limit) {
	const results = [];
    const limitedTracks = tracks.slice(0, limit);
	
	for (const track of limitedTracks) {
		const details = await fetchTrackDetails(track); // Wait for each track before proceeding
		results.push(details);
	}
	return results;
}

// Event listener for form submission (data load)
document.getElementById("username-form").addEventListener("submit", async (event) => {
	event.preventDefault();
	const username = document.getElementById("username").value.trim();

	// Try to load saved data for the username from IndexedDB
	let savedData = await getUserData(username).catch(err => {
		console.error("Error retrieving saved data", err);
		return null;
	});

    if (savedData) {
        // Saved data exists – retrieve the saved tracks, artists, and albums.
        let { allTracks: savedAllTracks, artistsData: savedArtistsData, albumsData: savedAlbumsData, tracksData: savedTracksData } = savedData.data;
    
        // Assign saved data to global variables
        artistsData = savedArtistsData || [];
        albumsData = savedAlbumsData || [];
        tracksData = savedTracksData || [];
    
        // Find the latest track date in the saved allTracks.
        let latestTimestamp = 0;
        savedAllTracks.forEach(track => {
            const ts = parseInt(track.Date);
            if (ts > latestTimestamp) latestTimestamp = ts;
        });
    
        // Fetch recent tracks from Last.fm that occurred after the latest saved track.
        loadingDiv.innerHTML = "<p>Fetching recent tracks...</p>";
        let newTracks = await fetchRecentTracksSince(username, latestTimestamp);
    
        // Merge new tracks with the saved tracks, keeping chronological order.
        allTracks = newTracks.concat(savedAllTracks);
    } else {
        // No saved data exists, fetch all history.
        allTracks = await fetchListeningHistory(username);
    }
    
    allTracks = allTracks.filter(track => {
        if (!track.Date) {
            console.warn("Skipping track due to missing date:", track);
            return false;
        }
        return true;
    });

    // Sort allTracks by date (assuming track.Date is a timestamp in milliseconds as a string)
    allTracks.sort((a, b) => parseInt(a.Date, 10) - parseInt(b.Date, 10));

    // Assign an order key (index + 1) to each track
    allTracks = allTracks.map((track, index) => {
        track.order = index + 1;
        return track;
    });

	// ✅ ALWAYS re-fetch the top stats to update rankings and counts!
	topArtists = await fetchTopArtists(username);
	topAlbums = await fetchTopAlbums(username);
	topTracks = await fetchTopTracks(username);

    // Reset track counts in artistsData and albumsData
    const artistTrackSets = {};
    const albumTrackSets = {};

    allTracks.forEach(item => {
        const artistKey = item.Artist.trim().toLowerCase();
        const albumKey = `${item.Album.trim().toLowerCase()}||${item.Artist.trim().toLowerCase()}`;
        const trackKey = item.Track.trim().toLowerCase();

        if (!artistTrackSets[artistKey]) artistTrackSets[artistKey] = new Set();
        if (!albumTrackSets[albumKey]) albumTrackSets[albumKey] = new Set();

        artistTrackSets[artistKey].add(trackKey);
        albumTrackSets[albumKey].add(trackKey);
    });

	// Objects to track earliest scrobbles
	const firstScrobbles = { artists: {}, albums: {}, tracks: {} };
    loadingDiv.innerHTML = "<p>Processing first scrobbles...</p>";

	// Iterate over allTracks to determine first scrobbles
	allTracks.forEach(track => {
		if (!track.Artist || !track.Track || !track.Date) {
			console.warn("Skipping track due to missing data:", track);
			return;
		}

		const artistKey = track.Artist.trim().toLowerCase();
		const albumKey = track.Album?.trim() ? `${track.Album.trim().toLowerCase()}_${artistKey}` : null;
		const trackKey = `${track.Track.trim().toLowerCase()}_${artistKey}`;
		const uts = parseInt(track.Date, 10); // Already in milliseconds

		if (!firstScrobbles.artists[artistKey] || uts < firstScrobbles.artists[artistKey]) {
			firstScrobbles.artists[artistKey] = uts;
		}
		if (albumKey && (!firstScrobbles.albums[albumKey] || uts < firstScrobbles.albums[albumKey])) {
			firstScrobbles.albums[albumKey] = uts;
		}
		if (!firstScrobbles.tracks[trackKey] || uts < firstScrobbles.tracks[trackKey]) {
			firstScrobbles.tracks[trackKey] = uts;
		}
	});

	// ✅ Update data arrays with correct first scrobbles
    const newArtistsData = topArtists.map((artist, index) => {
        const key = artist.name.trim().toLowerCase();
        return {
            name: artist.name,
            rank: index + 1, // Overwrite rank from the new fetch
            firstscrobble: firstScrobbles.artists?.[key] ?? null,
            user_scrobbles: parseInt(artist.user_scrobbles, 10) || 0,
            track_count: artistTrackSets[key] ? artistTrackSets[key].size : 0
        };
    });
    
    // Create newAlbumsData with track counts
    const newAlbumsData = topAlbums.map((album, index) => {
        const key = `${album.name.trim().toLowerCase()}||${album.artist.trim().toLowerCase()}`;
        return {
            name: album.name,
            artist: album.artist,
            rank: index + 1,
            firstscrobble: firstScrobbles.albums?.[key] ?? null,
            user_scrobbles: parseInt(album.user_scrobbles, 10) || 0,
            track_count: albumTrackSets[key] ? albumTrackSets[key].size : 0
        };
    });
    
    const newTracksData = topTracks.map((track, index) => {
        const key = `${track.name.trim().toLowerCase()}_${track.artist.trim().toLowerCase()}`;
        return {
            name: track.name,
            artist: track.artist,
            rank: index + 1,
            firstscrobble: firstScrobbles.tracks?.[key] ?? null,
            user_scrobbles: parseInt(track.user_scrobbles, 10) || 0
        };
    });
    
    loadingDiv.innerHTML = "<p>Merging data...</p>";

    // Merge new data into the existing arrays (only updating the keys specified)
    artistsData = mergeData(artistsData, newArtistsData, item => item.name.trim().toLowerCase());
    albumsData = mergeData(albumsData, newAlbumsData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);
    tracksData = mergeData(tracksData, newTracksData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);
    
    console.log("Merged artistsData:", artistsData);
	console.log("Merged albumsData:", albumsData);
	console.log("Merged tracksData:", tracksData);

    loadingDiv.innerHTML = "<p>Mapping artists...</p>";

    artistDataMap = artistsData.reduce((map, artist) => {
        map[artist.name.toLowerCase()] = artist;
        return map;
    }, {});

    loadingDiv.innerHTML = "<p>Mapping albums...</p>";
    
    albumDataMap = albumsData.reduce((map, album) => {
        map[`${album.name.toLowerCase()}||${album.artist.toLowerCase()}`] = album;
        return map;
    }, {});

    loadingDiv.innerHTML = "<p>Mapping tracks...</p>";
    
    trackDataMap = tracksData.reduce((map, track) => {
        map[`${track.name.toLowerCase()}||${track.artist.toLowerCase()}`] = track;
        return map;
    }, {});

	// ✅ Enable "Load Detailed Data" button
	const loadDetailedBtn = document.getElementById("load-detailed-data");
	loadDetailedBtn.disabled = false;
	loadDetailedBtn.title = "Click to load detailed data!";

	console.log("Final allTracks:", allTracks);
	loadingDiv.innerHTML = ""; // Clear loading message

	// ✅ Update UI
	applyFilters();
	updateActiveFilters();

});

document.getElementById("load-detailed-data").addEventListener("click", async () => {
	const confirmMsg = "Loading detailed data may take a long time and is subject to Last.fm API limits. Do you wish to continue?";
	if (!confirm(confirmMsg)) return;
	
	const username = document.getElementById("username").value.trim();

	// For Artists: choose those with >100 scrobbles or the top 250 (whichever is more)
	let selectedArtists = topArtists.filter(artist => artist.playcount > 100);
	if (selectedArtists.length < artistLimit) {
		selectedArtists = topArtists.slice(0, artistLimit);
	}
	const fetchedArtists = await fetchAllArtistDetails(selectedArtists, artistLimit);
	console.log("Fetched artist details:", fetchedArtists);

	// For Albums: choose those with >10 scrobbles or the top 500 (whichever is more)
	let selectedAlbums = topAlbums.filter(album => album.playcount > 10);
	if (selectedAlbums.length < albumLimit) {
		selectedAlbums = topAlbums.slice(0, albumLimit);
	}
	const fetchedAlbums = await fetchAllAlbumDetails(selectedAlbums, albumLimit);
	console.log("Fetched album details:", fetchedAlbums);

	// For Tracks: choose those with >5 scrobbles or the top 1000 (whichever is more)
	let selectedTracks = topTracks.filter(track => track.playcount > 5);
	if (selectedTracks.length < trackLimit) {
		selectedTracks = topTracks.slice(0, trackLimit);
	}
	const fetchedTracks = await fetchAllTrackDetails(selectedTracks, trackLimit);
	console.log("Fetched track details:", fetchedTracks);

	// Process fetched data and format it before merging
	const newArtistsData = fetchedArtists.map(artist => ({
        ...artist,
        name: artist.name,
        listeners: parseInt(artist.listeners, 10) || 0,
        playcount: parseInt(artist.playcount, 10) || 0,
        tags: artist.tags || []
    }));
    
    const newAlbumsData = fetchedAlbums.map(album => ({
        ...album,
        name: album.name,
        artist: album.artist,
        listeners: parseInt(album.listeners, 10) || 0,
        playcount: parseInt(album.playcount, 10) || 0,
    }));
    
    const newTracksData = fetchedTracks.map(track => ({
        ...track,
        name: track.name,
        artist: track.artist?.name || track.artist,
        duration: parseInt(track.duration, 10) || 0,
        listeners: parseInt(track.listeners, 10) || 0,
        playcount: parseInt(track.playcount, 10) || 0
    }));

	// Merge the new data into existing global arrays while keeping firstscrobble, user_scrobbles, and rank
    artistsData = mergeData(artistsData, newArtistsData, item => item.name.trim().toLowerCase());
    albumsData = mergeData(albumsData, newAlbumsData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);
    tracksData = mergeData(tracksData, newTracksData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);

	console.log("Merged artistsData:", artistsData);
	console.log("Merged albumsData:", albumsData);
	console.log("Merged tracksData:", tracksData);

	// Update display, filters, etc.
	loadingDiv.innerHTML = ""; // Clear loading message
	applyFilters();
});

function handleLoadAllDataToggle() {
    const loadAllData = document.getElementById("load-all-data").checked;

    // If checked, set limits to maximum possible values (effectively no limit)
    artistLimit = loadAllData ? Infinity : 250;
    albumLimit = loadAllData ? Infinity : 500;
    trackLimit = loadAllData ? Infinity : 1000;

}

// Attach event listener to checkbox
document.getElementById("load-all-data").addEventListener("change", handleLoadAllDataToggle);

// Load CSV file
document.getElementById('csv-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const csvData = e.target.result;

        // ✅ Parse the CSV (including extracting username)
        allTracks = parseCSV(csvData);

        // ✅ Try extracting the username if missing
        if (!allTracks.username) {
            console.warn("Username missing from parsed data, checking CSV manually...");
            const firstLine = csvData.split("\n")[0]; // Get the first line
            console.log("CSV First Line:", firstLine);

            const match = firstLine.match(/Date#(.*)/);
            if (match && match[1]) {
                allTracks.username = match[1].trim();
                console.log("Extracted username from CSV:", allTracks.username);
            } else {
                console.error("Failed to extract Last.fm username from CSV.");
                return;
            }
        }

        // ✅ Ensure a username exists after parsing
        if (!allTracks.username) {
            console.error("Failed to extract Last.fm username from CSV.");
            return;
        }
        const username = allTracks.username;
        console.log("Detected Last.fm username:", username);

        // ✅ Initialize tracking objects
        raw_data = [];
        const firstScrobbles = { artists: {}, albums: {}, tracks: {} };
        const artistTrackSets = {};
        const albumTrackSets = {};

        // ✅ Iterate over allTracks to determine first scrobbles and track counts
        allTracks.forEach(track => {
            if (!track.artist || !track.track || !track.date) {
                console.warn("Skipping track due to missing data:", track);
                return;
            }

            const artistKey = track.artist.trim().toLowerCase();
            const albumKey = track.album?.trim() ? `${track.album.trim().toLowerCase()}_${artistKey}` : null;
            const trackKey = `${track.track.trim().toLowerCase()}_${artistKey}`;
            const uts = parseInt(track.date, 10); // Already in milliseconds

            if (!firstScrobbles.artists[artistKey] || uts < firstScrobbles.artists[artistKey]) {
                firstScrobbles.artists[artistKey] = uts;
            }
            if (albumKey && (!firstScrobbles.albums[albumKey] || uts < firstScrobbles.albums[albumKey])) {
                firstScrobbles.albums[albumKey] = uts;
            }
            if (!firstScrobbles.tracks[trackKey] || uts < firstScrobbles.tracks[trackKey]) {
                firstScrobbles.tracks[trackKey] = uts;
            }

            if (!artistTrackSets[artistKey]) artistTrackSets[artistKey] = new Set();
            if (!albumTrackSets[albumKey]) albumTrackSets[albumKey] = new Set();
            
            artistTrackSets[artistKey].add(trackKey);
            albumTrackSets[albumKey].add(trackKey);

            // Add to raw_data
            raw_data.push({
                Artist: track.artist,
                Album: track.album,
                Track: track.track,
                Date: uts
            });
        });

        // ✅ Sort by Date (oldest first) and assign order
        raw_data.sort((a, b) => a.date - b.date);
        raw_data.forEach((track, index) => {
            track.order = index + 1;
        });

        allTracks = raw_data; // Update allTracks with sorted data

        // ✅ Fetch top stats using the extracted username
        const topArtists = await fetchTopArtists(username);
        const topAlbums = await fetchTopAlbums(username);
        const topTracks = await fetchTopTracks(username);

        // ✅ Ensure first scrobbles are properly retrieved
        console.log("First Scrobbles Data:", firstScrobbles);

        // ✅ Update data arrays with correct first scrobbles
        artistsData = topArtists.map((artist, index) => {
            if (!artist.name) return null; // Prevent undefined objects

            const artistKey = artist.name.trim().toLowerCase();
            return {
                name: artist.name,
                rank: index + 1,
                firstscrobble: firstScrobbles.artists?.[artistKey] ?? null,
                user_scrobbles: parseInt(artist.user_scrobbles, 10) || 0,
                track_count: artistTrackSets[artistKey] ? artistTrackSets[artistKey].size : 0,
            };
        }).filter(Boolean);

        albumsData = topAlbums.map((album, index) => {
            if (!album.name || !album.artist) return null;

            const albumKey = `${album.name.trim().toLowerCase()}_${album.artist.trim().toLowerCase()}`;
            return {
                name: album.name,
                artist: album.artist,
                rank: index + 1,
                firstscrobble: firstScrobbles.albums?.[albumKey] ?? null,
                user_scrobbles: parseInt(album.user_scrobbles, 10) || 0,
                track_count: albumTrackSets[albumKey] ? albumTrackSets[albumKey].size : 0,
            };
        }).filter(Boolean);

        tracksData = topTracks.map((track, index) => {
            if (!track.name || !track.artist) return null;

            const trackKey = `${track.name.trim().toLowerCase()}_${track.artist.trim().toLowerCase()}`;
            return {
                name: track.name,
                artist: track.artist,
                rank: index + 1,
                firstscrobble: firstScrobbles.tracks?.[trackKey] ?? null,
                user_scrobbles: parseInt(track.user_scrobbles, 10) || 0,
            };
        }).filter(Boolean);

        loadingDiv.innerHTML = "<p>Mapping artists...</p>";

        artistDataMap = artistsData.reduce((map, artist) => {
            map[artist.name.toLowerCase()] = artist;
            return map;
        }, {});
    
        loadingDiv.innerHTML = "<p>Mapping albums...</p>";
        
        albumDataMap = albumsData.reduce((map, album) => {
            map[`${album.name.toLowerCase()}||${album.artist.toLowerCase()}`] = album;
            return map;
        }, {});
    
        loadingDiv.innerHTML = "<p>Mapping tracks...</p>";
        
        trackDataMap = tracksData.reduce((map, track) => {
            map[`${track.name.toLowerCase()}||${track.artist.toLowerCase()}`] = track;
            return map;
        }, {});

        // ✅ Enable "Load Detailed Data" button
        const loadDetailedBtn = document.getElementById("load-detailed-data");
        loadDetailedBtn.disabled = false;
        loadDetailedBtn.title = "Click to load detailed data!";

        console.log("Final allTracks:", allTracks);
        console.log("Updated artistsData:", artistsData);
        console.log("Updated albumsData:", albumsData);
        console.log("Updated tracksData:", tracksData);

        loadingDiv.innerHTML = ""; // Clear loading message

        // ✅ Update UI
        applyFilters();
        updateActiveFilters();
    };
    reader.readAsText(file);
});

// Parse CSV data
function parseCSV(data) {
    const lines = data.trim().split('\n');
    const headers = lines[0].split(';').map(header => header.trim().toLowerCase());

    // Find the date header and rename it to 'date'
    const dateHeader = headers.find(header => header.startsWith('date#'));
    const renamedHeaders = headers.map(header => (header === dateHeader ? 'date' : header));

    // Get the timezone offset from the dropdown
    const timezoneOffset = new Date().getTimezoneOffset() * 60000;

    return lines.slice(1).map(line => {
        const values = line.match(/(".*?"|[^;]+)(?=;|$)/g)
            .map(val => val.replace(/"/g, '').trim());

        const track = renamedHeaders.reduce((obj, header, index) => {
            obj[header] = values[index] || "";
            return obj;
        }, {});

        // Adjust the date based on the timezone offset
        if (track.date) {
            const timestamp = parseInt(track.date);
            if (!isNaN(timestamp)) {
                track.date = (timestamp - timezoneOffset).toString();
            }
        }

        return track;
    });
}

/**
 * Computes a mapping from a group key to its global ranking and total scrobble count,
 * based on allTracks (the unfiltered list). The group key is defined differently depending
 * on the entityType.
 * @param {string} entityType - "track", "album", or "artist".
 * @returns {Object} - Mapping: { groupKey: { rank, count } }
 */
function computeUnfilteredStats(entityType) {
    const groups = {};
    if (entityType === 'track') {
        allTracks.forEach(track => {
            const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
            if (!groups[key]) {
                groups[key] = { count: 0 };
            }
            groups[key].count++;
        });
    } else if (entityType === 'album') {
        allTracks.forEach(track => {
            const key = `${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`;
            if (!groups[key]) {
                groups[key] = { count: 0 };
            }
            groups[key].count++;
        });
    } else if (entityType === 'artist') {
        allTracks.forEach(track => {
            const key = track.Artist.toLowerCase();
            if (!groups[key]) {
                groups[key] = { count: 0 };
            }
            groups[key].count++;
        });
    }
    // Convert to array and sort descending by count.
    const groupArray = Object.entries(groups).map(([key, data]) => ({ key, count: data.count }));
    groupArray.sort((a, b) => b.count - a.count);
    // Now assign ranking (1-indexed)
    const mapping = {};
    groupArray.forEach((item, index) => {
        mapping[item.key] = { rank: index + 1, count: item.count };
    });
    return mapping;
}

/**
 * Calculate the number of separate periods (day/week/month) an entity (track/album/artist) has been scrobbled.
 * @param {Array} tracks - Array of track objects.
 * @param {string} period - The period to calculate ('day', 'week', 'month').
 * @param {string} [entityType='track'] - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with counts of separate periods.
 */
function calculateSeparateScrobbles(tracks, period, entityType = 'track') {
    console.log(`Calculating separate scrobbles for period: ${period}, entityType: ${entityType}`);
    
    // Grouping key based on entityType
    const groupKeyFunc = (track) => {
        if (entityType === 'track') {
            return `${track.Artist} - ${track.Track}`; // Group by Artist & Track
        } else if (entityType === 'album') {
            return `${track.Album}||${track.Artist}`;   // Group by Album & Artist
        } else if (entityType === 'artist') {
            return track.Artist;                       // Group by Artist only
        } else {
            return `${track.Artist} - ${track.Track}`;
        }
    };

    const groups = tracks.reduce((acc, track) => {
        const key = groupKeyFunc(track);
        if (!acc[key]) {
            acc[key] = {
                count: 0,
                dates: new Set()
            };
            if (entityType === 'track') {
                acc[key].Artist = track.Artist;
                acc[key].Track = track.Track;
            } else if (entityType === 'album') {
                acc[key].name = track.Album;
                acc[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                acc[key].name = track.Artist;
            }
        }
        if (track.Date) {
            const timestamp = parseInt(track.Date);
            if (!isNaN(timestamp)) {
                const date = new Date(timestamp); // Date is in ms already
                let periodKey;
                switch (period) {
                    case 'day':
                        periodKey = date.toISOString().split('T')[0];
                        break;
                    case 'week':
                        periodKey = `${date.getFullYear()}-W${getWeekNumber(date)}`;
                        break;
                    case 'month':
                        periodKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
                        break;
                    default:
                        periodKey = date.toISOString().split('T')[0];
                }
                if (!acc[key].dates.has(periodKey)) {
                    acc[key].count++;
                    acc[key].dates.add(periodKey);
                }
            }
        }
        return acc;
    }, {});

    console.log('Separate scrobbles groups:', groups);
    return Object.values(groups);
}

function calculateConsecutiveScrobbles(tracks, entityType = 'track') {
    // Sort tracks by Date (ascending order)
    tracks.sort((a, b) => parseInt(a.Date) - parseInt(b.Date));

    // Define grouping key based on entityType
    const groupKeyFunc = (track) => {
        if (entityType === 'track') {
            return `${track.Artist} - ${track.Track}`;
        } else if (entityType === 'album') {
            return `${track.Album}||${track.Artist}`;
        } else if (entityType === 'artist') {
            return track.Artist;
        } else {
            return `${track.Artist} - ${track.Track}`;
        }
    };

    const groups = tracks.reduce((acc, track, index, array) => {
        const key = groupKeyFunc(track);
        
        if (!acc[key]) {
            acc[key] = {
                maxConsecutive: 0,
                currentConsecutive: 0,
                startTime: null,
                endTime: null,
                currentStartTime: null
            };
            if (entityType === 'track') {
                acc[key].Artist = track.Artist;
                acc[key].Track = track.Track;
            } else if (entityType === 'album') {
                acc[key].name = track.Album;
                acc[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                acc[key].name = track.Artist;
            }
        }

        // Get the previous track in the array
        const prevTrack = index > 0 ? array[index - 1] : null;
        
        // If it's the first track in group OR order is NOT consecutive, reset count
        if (!prevTrack || groupKeyFunc(prevTrack) !== key || track.order !== prevTrack.order + 1) {
            acc[key].currentConsecutive = 1;
            acc[key].currentStartTime = track.Date;
        } else {
            acc[key].currentConsecutive++;
        }

        // Update max consecutive count
        if (acc[key].currentConsecutive > acc[key].maxConsecutive) {
            acc[key].maxConsecutive = acc[key].currentConsecutive;
            acc[key].startTime = acc[key].currentStartTime;
            acc[key].endTime = track.Date;
        }

        return acc;
    }, {});

    return Object.values(groups);
}

function calculateConsecutivePeriods(tracks, period, entityType = 'track') {
	// Sort tracks by Date (assuming Date is in ms as string)
	tracks.sort((a, b) => parseInt(a.Date) - parseInt(b.Date));

	const groupKeyFunc = (track) => {
		if (entityType === 'track') {
			return `${track.Artist} - ${track.Track}`;
		} else if (entityType === 'album') {
			return `${track.Album}||${track.Artist}`;
		} else if (entityType === 'artist') {
			return track.Artist;
		} else {
			return `${track.Artist} - ${track.Track}`;
		}
	};

	const results = {};
	const processed = new Set();

	for (let i = 0; i < tracks.length; i++) {
		const key = groupKeyFunc(tracks[i]);
		if (processed.has(key)) continue;
		processed.add(key);
		const groupTracks = tracks.filter((t) => groupKeyFunc(t) === key);
		const periodsSet = new Set();

		groupTracks.forEach((track) => {
			const timestamp = parseInt(track.Date);
			if (isNaN(timestamp)) return;
			const date = new Date(timestamp);
			let periodKey;
			switch (period) {
				case 'day':
					periodKey = Math.floor(timestamp / 86400000);
					break;
				case 'week':
					periodKey = getWeekIdentifier(date);
					break;
				case 'month':
					periodKey = date.getFullYear() * 12 + date.getMonth();
					break;
				default:
					periodKey = Math.floor(timestamp / 86400000);
			}
			periodsSet.add(periodKey);
		});

		const sortedPeriods = Array.from(periodsSet).sort((a, b) => a - b);
		let maxConsecutive = 1,
			currentConsecutive = 1,
			lastPeriod = null,
			startTime = null,
			endTime = null,
			bestStartTime = null,
			bestEndTime = null;

		sortedPeriods.forEach((currentPeriod, index) => {
			if (lastPeriod !== null && isNextPeriod(lastPeriod, currentPeriod, period)) {
				currentConsecutive++;
				endTime = getMatchingTrackTime(groupTracks, currentPeriod, period);
			} else {
				if (currentConsecutive > maxConsecutive) {
					maxConsecutive = currentConsecutive;
					bestStartTime = startTime;
					bestEndTime = endTime;
				}
				currentConsecutive = 1;
				startTime = getMatchingTrackTime(groupTracks, currentPeriod, period);
				endTime = startTime;
			}
			lastPeriod = currentPeriod;
		});

		// Final streak check
		if (currentConsecutive > maxConsecutive) {
			maxConsecutive = currentConsecutive;
			bestStartTime = startTime;
			bestEndTime = endTime;
		}

		results[key] = {
			maxConsecutive,
			startTime: bestStartTime,
			endTime: bestEndTime,
		};

		// Add group info based on entityType.
		const sample = groupTracks[0];
		if (entityType === 'track') {
			results[key].Artist = sample.Artist;
			results[key].Track = sample.Track;
		} else if (entityType === 'album') {
			results[key].name = sample.Album;
			results[key].artist = sample.Artist;
		} else if (entityType === 'artist') {
			results[key].name = sample.Artist;
		}
	}
	return Object.values(results);
}

// Helper function to find a matching track's timestamp
function getMatchingTrackTime(groupTracks, periodKey, period) {
	const matchingTrack = groupTracks.find((t) => {
		const ts = parseInt(t.Date);
		const d = new Date(ts);
		let pKey;
		switch (period) {
			case 'day':
				pKey = Math.floor(ts / 86400000);
				break;
			case 'week':
				pKey = getWeekIdentifier(d);
				break;
			case 'month':
				pKey = d.getFullYear() * 12 + d.getMonth();
				break;
		}
		return pKey === periodKey;
	});
	return matchingTrack ? matchingTrack.Date : null;
}

// Convert a date to a unique week identifier
function getWeekIdentifier(date) {
    const firstJan = new Date(date.getFullYear(), 0, 1);
    const daysOffset = Math.floor((date - firstJan) / 86400000);
    return date.getFullYear() * 52 + Math.ceil((daysOffset + firstJan.getDay()) / 7);
}

// Check if two periods are consecutive
function isNextPeriod(prev, curr, periodType) {
    if (periodType === 'day') {
        return curr === prev + 1; // Next day in numerical sequence
    } else if (periodType === 'week' || periodType === 'month') {
        return curr === prev + 1; // Next week/month in numerical sequence
    }
    return false;
}

function calculateListeningPercentage(tracks, entityType = 'track') {
    console.log(`Calculating listening percentage for entityType: ${entityType}`);

    // Grouping key based on entityType
    const groupKeyFunc = (track) => {
        if (entityType === 'track') {
            return `${track.Artist} - ${track.Track}`; // Group by Artist & Track
        } else if (entityType === 'album') {
            return `${track.Album}||${track.Artist}`;   // Group by Album & Artist
        } else if (entityType === 'artist') {
            return track.Artist;                       // Group by Artist only
        } else {
            return `${track.Artist} - ${track.Track}`;
        }
    };

    // To track processed entities and avoid duplication in calculations
    const processedEntities = new Set();

    const groups = tracks.reduce((acc, track) => {
        const key = groupKeyFunc(track);
        if (processedEntities.has(key)) {
            return acc; // Skip processing if the entity has already been processed
        }
        processedEntities.add(key);

        if (!acc[key]) {
            acc[key] = {
                listeningPercentage: 0,
                scrobbles: 0,
                playcount: 0
            };
            if (entityType === 'track') {
                acc[key].Artist = track.Artist;
                acc[key].Track = track.Track;
            } else if (entityType === 'album') {
                acc[key].name = track.Album;
                acc[key].artist = track.Artist;
            } else if (entityType === 'artist') {
                acc[key].name = track.Artist;
            }
        }

        // Get the playcount and user scrobbles from the data maps for album/artist/track
        let scrobbles = 0;
        let playcount = 0;

        // Assuming trackDataMap, albumDataMap, and artistDataMap are available and contain playcount and user_scrobbles
        if (entityType === 'track') {
            scrobbles = trackDataMap[`${track.Track.toLowerCase()}||${track.Artist.toLowerCase()}`]?.user_scrobbles || 0;
            playcount = trackDataMap[`${track.Track.toLowerCase()}||${track.Artist.toLowerCase()}`]?.playcount || 0;
        } else if (entityType === 'album') {
            scrobbles = albumDataMap[`${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`]?.user_scrobbles || 0;
            playcount = albumDataMap[`${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`]?.playcount || 0;
        } else if (entityType === 'artist') {
            scrobbles = artistDataMap[track.Artist.toLowerCase()]?.user_scrobbles || 0;
            playcount = artistDataMap[track.Artist.toLowerCase()]?.playcount || 0;
        }

        // Calculate listening percentage and update the group's data
        if (playcount > 0) {
            const listeningPercentage = (scrobbles / playcount) * 100;
            acc[key].listeningPercentage = listeningPercentage;
        }

        acc[key].scrobbles += scrobbles;
        acc[key].playcount += playcount;

        return acc;
    }, {});

    // Convert the grouped data into an array for returning
    const result = Object.values(groups);

    // Sort by listening percentage in descending order
    result.sort((a, b) => b.listeningPercentage - a.listeningPercentage);

    console.log('Listening percentage groups:', result);
    return result;
}

/**
 * Calculate listening duration for each entity (track/album/artist).
 * @param {Array} filteredData - Array of track objects after filtering.
 * @param {string} entityType - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with listening durations.
 */
function calculateListeningDuration(filteredData, entityType = 'track') {
    console.log(`Calculating listening duration for entityType: ${entityType}`);

    // Step 1: Group tracks by Artist + Track
    const trackGroups = {};

    filteredData.forEach(track => {
        const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
        
        if (!trackGroups[key]) {
            trackGroups[key] = { ...track, count: 0, albumCounts: {}, duration: 0 };
        }
        trackGroups[key].count++;

        // Count album occurrences to get the most common album for the track
        const albumName = track.Album;
        if (!trackGroups[key].albumCounts[albumName]) {
            trackGroups[key].albumCounts[albumName] = 0;
        }
        trackGroups[key].albumCounts[albumName]++;

        // Get the duration of the track from trackDataMap
        trackGroups[key].duration = trackDataMap[`${track.Track.toLowerCase()}||${track.Artist.toLowerCase()}`]?.duration || 0;
    });

    // Convert the grouped data into an array
    filteredData = Object.values(trackGroups);

    // Step 2: If entityType is 'track', return the listening duration for tracks
    if (entityType === 'track') {
        return filteredData.map(track => {
            return {
                ...track,
                listeningDuration: track.duration * track.count
            };
        }).sort((a, b) => b.listeningDuration - a.listeningDuration); // Sort by listeningDuration
    }

    // Step 3: Aggregate by artist or album
    const aggregatedData = filteredData.reduce((acc, track) => {
        const entityKey = entityType === 'album' ? track.Album : track.Artist; // Use Album for album-type, Artist otherwise
    
        // Ensure that the key is consistent and add artist for albums
        if (!acc[entityKey]) {
            acc[entityKey] = { 
                listeningDuration: 0, 
                name: entityKey, 
                artist: entityType === 'album' ? track.Artist : null // Only add artist for albums
            };
        }
    
        // Add the track's listening duration to the entity's total listening duration
        acc[entityKey].listeningDuration += track.duration * track.count;
    
        return acc;
    }, {});

    // Convert aggregated data into an array and sort by listeningDuration
    const sortedAggregatedData = Object.values(aggregatedData).sort((a, b) => b.listeningDuration - a.listeningDuration);

    console.log('Aggregated listening durations:', sortedAggregatedData);
    return sortedAggregatedData;
}

/**
 * Format the duration from milliseconds into a readable string: "x days y hours z minutes".
 * @param {number} durationInMillis - Duration in milliseconds.
 * @returns {string} - Formatted duration string.
 */
function formatDuration(durationInMillis) {
    const days = Math.floor(durationInMillis / (1000 * 60 * 60 * 24));
    const hours = Math.floor((durationInMillis % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((durationInMillis % (1000 * 60 * 60)) / (1000 * 60));

    let result = '';
    if (days > 0) result += `${days} day${days > 1 ? 's' : ''} `;
    if (hours > 0) result += `${hours} hour${hours > 1 ? 's' : ''} `;
    if (minutes > 0) result += `${minutes} minute${minutes > 1 ? 's' : ''}`;

    return result.trim();
}

function displayTopTracks(tracks) {
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = document.getElementById("sorting-basis").value; // e.g. "scrobbles", "consecutive-days", etc.
    const listLength = parseInt(document.getElementById("list-length").value) || 10;
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("track");
    }
    
    tracks.slice(0, listLength).forEach((track, index) => {
        const trackDiv = document.createElement("div");
        trackDiv.classList.add("track");
        let additionalInfo = '';
        additionalInfo = getAdditionalInfo(sortingBasis, track);
        

        // If the track appears on multiple albums, display the album with the highest scrobble count.
        let albumDisplay = '';
        if (track.albumCounts) {
            let maxCount = 0;
            for (const album in track.albumCounts) {
                if (track.albumCounts[album] > maxCount) {
                    maxCount = track.albumCounts[album];
                    albumDisplay = album;
                }
            }
        }

        // If unfiltered stats should be shown, look up the global ranking and count.
        let unfilteredInfo = '';
        if (showUnfiltered) {
            const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
            if (unfilteredMapping[key]) {
                unfilteredInfo = ` (#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        trackDiv.innerHTML = `
            <strong>${index + 1}. ${track.Track}</strong> by ${track.Artist}${unfilteredInfo}
            ${albumDisplay ? `<br>Album: ${albumDisplay}` : ''}
            <br>${additionalInfo}
        `;
        resultsDiv.appendChild(trackDiv);
    });
}

function displayTopAlbums(albums) {
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = document.getElementById("sorting-basis").value;
    const listLength = parseInt(document.getElementById("list-length").value) || 10;
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("album");
    }

    albums.slice(0, listLength).forEach((album, index) => {
        const albumDiv = document.createElement("div");
        albumDiv.classList.add("album");
        let additionalInfo = '';

        additionalInfo = getAdditionalInfo(sortingBasis, album);

        let unfilteredInfo = '';
        if (showUnfiltered) {
            const key = `${album.name.toLowerCase()}||${album.artist.toLowerCase()}`;
            if (unfilteredMapping[key]) {
                unfilteredInfo = ` (#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        albumDiv.innerHTML = `
            <strong>${index + 1}. ${album.name}</strong> by ${album.artist}${unfilteredInfo}<br>
            ${additionalInfo}
        `;
        resultsDiv.appendChild(albumDiv);
    });
}

function displayTopArtists(artists) {
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = "";
    const sortingBasis = document.getElementById("sorting-basis").value;
    const listLength = parseInt(document.getElementById("list-length").value) || 10;
    const showUnfiltered = document.getElementById("unfiltered-stats").checked;
    let unfilteredMapping = {};
    if (showUnfiltered) {
        unfilteredMapping = computeUnfilteredStats("artist");
    }

    artists.slice(0, listLength).forEach((artist, index) => {
        const artistDiv = document.createElement("div");
        artistDiv.classList.add("artist");
        let additionalInfo = '';

        additionalInfo = getAdditionalInfo(sortingBasis, artist);

        let unfilteredInfo = '';
        if (showUnfiltered) {
            const key = artist.name.toLowerCase();
            if (unfilteredMapping[key]) {
                unfilteredInfo = ` (#${unfilteredMapping[key].rank}, ${unfilteredMapping[key].count})`;
            }
        }

        artistDiv.innerHTML = `
            <strong>${index + 1}. ${artist.name}</strong>${unfilteredInfo}<br>
            ${additionalInfo}
        `;
        resultsDiv.appendChild(artistDiv);
    });
}

function getAdditionalInfo(sortingBasis, entity) {
	if (sortingBasis === 'separate-days') {
		return `Different days: ${entity.count}`;
	} else if (sortingBasis === 'separate-weeks') {
		return `Different weeks: ${entity.count}`;
	} else if (sortingBasis === 'separate-months') {
		return `Different months: ${entity.count}`;
	} else if (sortingBasis.startsWith('consecutive-')) {
		const startDate = entity.startTime ? new Date(parseInt(entity.startTime)).toISOString().split('T')[0] : 'N/A';
		const endDate = entity.endTime ? new Date(parseInt(entity.endTime)).toISOString().split('T')[0] : 'N/A';
		let periodLabel = sortingBasis.replace('consecutive-', '').replace('-', ' ');
		return `Max consecutive ${periodLabel}: ${entity.maxConsecutive}<br>Start: ${startDate}<br>End: ${endDate}`;
	} else if (sortingBasis === 'highest-listening-percentage') {
        return `Listening %: ${entity.listeningPercentage.toFixed(2)}%<br>Scrobbles: ${entity.scrobbles}<br>Playcount: ${entity.playcount}`;
    } else if (sortingBasis === 'time-spent-listening') {
        return `Listening time: ${formatDuration(entity.listeningDuration)}`;
    } else {
		return `Scrobbles: ${entity.count}`;
	}
}

function getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

function normalizeText(str) {
    // Lowercase, trim, and remove hyphens for a more forgiving comparison.
    return str.trim().toLowerCase().replace(/-/g, '');
}
  
  /**
   * Returns true if the propertyValue (a string) contains the tokens specified
   * in filterInput according to the following logic:
   * - If filterInput is empty, returns true.
   * - If filterInput contains semicolons, each semicolon-separated group must have at least one token (after splitting by commas) that is found within propertyValue.
   * - If filterInput does not contain semicolons, returns true if any of the comma-separated tokens are found.
   */
  function matchFilter(filterInput, propertyValue) {
    // Ensure propertyValue is a string (convert arrays to a single string)
    const normalizedProp = Array.isArray(propertyValue) 
        ? propertyValue.map(normalizeText).join(" ")  // Convert array to a single string
        : normalizeText(propertyValue);

    const input = filterInput.trim().toLowerCase();
    if (!input) return true; // empty filter passes

    if (input.indexOf(';') !== -1) {
        // Split into groups (AND logic across groups)
        const groups = input.split(';').map(group =>
            group.split(',').map(tag => normalizeText(tag)).filter(tag => tag !== '')
        );
        // For each group, at least one token must be found in the property.
        return groups.every(group => group.some(token => normalizedProp.includes(token)));
    } else {
        // Comma-separated tokens: OR logic
        const tokens = input.split(',').map(token => normalizeText(token)).filter(token => token !== '');
        return tokens.some(token => normalizedProp.includes(token));
    }
}
  
  /**
   * For excludes, we simply invert the result of matchFilter.
   */
function matchExclude(filterInput, propertyValue) {
    return !matchFilter(filterInput, propertyValue);
}
  
function getSelectedValues(selectElementId) {
    const select = document.getElementById(selectElementId);
    return Array.from(select.selectedOptions).map(option => option.value);
}

function addFilter(id, value) {
    if (value.trim() === "") {
        removeFilter(id);
        return;
    }
    const existingFilter = activeFilters.find(filter => filter.id === id);
    if (existingFilter) {
        existingFilter.value = value;
    } else {
        activeFilters.push({ id, value });
    }
}

function removeFilter(id) {
    const index = activeFilters.findIndex(filter => filter.id === id);
    if (index !== -1) {
        activeFilters.splice(index, 1);
    }
}

function applyTracksPerEntityFilter(tracks, maxArtist) {

    // To track how many tracks we have included from each album and artist
    let artistCount = {};

    // Result list for the filtered tracks
    let filteredTracks = [];

    // Loop through the sorted tracks
    for (let track of tracks) {
        let artist = track.Artist;

        // Check if we've already added a track from this album or artist
        if (maxArtist && artistCount[artist] >= maxArtist) {
            continue; // Skip if the album or artist has reached its limit
        }

        // Add the track to the result list
        filteredTracks.push(track);

        // Increment the counts for the album and artist
        artistCount[artist] = (artistCount[artist] || 0) + 1;
    }

    return filteredTracks;
}

function applyFilters() {
    if (!allTracks) return;
    let filteredData = allTracks;
    const entityType = document.getElementById("entity-type").value;
    const sortingBasis = document.getElementById("sorting-basis").value;
    const maxPerArtist = parseInt(document.getElementById("max-per-artist").value) || Infinity;

    const filterFunctions = {

        // Filters based on name or title

        "artist-initial": (item, value) => item.Artist[0].toLowerCase() === value.toLowerCase(),
        "album-initial": (item, value) => item.Album[0].toLowerCase() === value.toLowerCase(),
        "track-initial": (item, value) => item.Track[0].toLowerCase() === value.toLowerCase(),

        "artist-name": (item, value) => item.Artist.toLowerCase() === value.toLowerCase(),
        "album-name": (item, value) => item.Album.toLowerCase() === value.toLowerCase(),
        "track-name": (item, value) => item.Track.toLowerCase() === value.toLowerCase(),

        "artist-includes": (item, value) => matchFilter(value, item.Artist),
        "artist-excludes": (item, value) => matchExclude(value, item.Artist),
        "album-includes": (item, value) => matchFilter(value, item.Album),
        "album-excludes": (item, value) => matchExclude(value, item.Album),
        "track-includes": (item, value) => matchFilter(value, item.Track),
        "track-excludes": (item, value) => matchExclude(value, item.Track),

        "artist-name-length-min": (item, value) => item.Artist.length >= parseInt(value, 10),
        "artist-name-length-max": (item, value) => item.Artist.length <= parseInt(value, 10),
        "album-name-length-min": (item, value) => item.Album.length >= parseInt(value, 10),
        "album-name-length-max": (item, value) => item.Album.length <= parseInt(value, 10),
        "track-name-length-min": (item, value) => item.Track.length >= parseInt(value, 10),
        "track-name-length-max": (item, value) => item.Track.length <= parseInt(value, 10),
       
        "artist-word-count-min": (item, value) => item.Artist.split(/\s+/).length >= parseInt(value, 10),
        "artist-word-count-max": (item, value) => item.Artist.split(/\s+/).length <= parseInt(value, 10),
        "album-word-count-min": (item, value) => item.Album.split(/\s+/).length >= parseInt(value, 10),
        "album-word-count-max": (item, value) => item.Album.split(/\s+/).length <= parseInt(value, 10),
        "track-word-count-min": (item, value) => item.Track.split(/\s+/).length >= parseInt(value, 10),
        "track-word-count-max": (item, value) => item.Track.split(/\s+/).length <= parseInt(value, 10),

        // Filters based on user data

        "artist-scrobble-count-min": (item, value) => 
            artistDataMap[item.Artist.toLowerCase()]?.user_scrobbles >= parseInt(value, 10),
        "artist-scrobble-count-max": (item, value) =>
            artistDataMap[item.Artist.toLowerCase()]?.user_scrobbles <= parseInt(value, 10),
        "album-scrobble-count-min": (item, value) =>
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles >= parseInt(value, 10),
        "album-scrobble-count-max": (item, value) =>
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles <= parseInt(value, 10),
        "track-scrobble-count-min": (item, value) =>
            trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles >= parseInt(value, 10),
        "track-scrobble-count-max": (item, value) =>
            trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles <= parseInt(value, 10),
        
        "artist-rank-min": (item, value) => 
            artistDataMap[item.Artist.toLowerCase()]?.rank >= parseInt(value, 10),

        "artist-rank-max": (item, value) => 
            artistDataMap[item.Artist.toLowerCase()]?.rank <= parseInt(value, 10),

        "album-rank-min": (item, value) => 
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank >= parseInt(value, 10),

        "album-rank-max": (item, value) => 
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank <= parseInt(value, 10),

        "track-rank-min": (item, value) => 
            trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank >= parseInt(value, 10),

        "track-rank-max": (item, value) => 
            trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank <= parseInt(value, 10),

        "artist-track-count-min": (item, value) => 
            artistDataMap[item.Artist.toLowerCase()]?.track_count >= parseInt(value, 10),

        "artist-track-count-max": (item, value) => 
            artistDataMap[item.Artist.toLowerCase()]?.track_count <= parseInt(value, 10),

        "album-track-count-min": (item, value) => 
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.track_count >= parseInt(value, 10),

        "album-track-count-max": (item, value) => 
            albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.track_count <= parseInt(value, 10),

        "artist-first-scrobble-years": (item, value) => {
            const firstYear = artistDataMap[item.Artist.toLowerCase()]?.firstscrobble 
                ? new Date(parseInt(artistDataMap[item.Artist.toLowerCase()].firstscrobble, 10)).getFullYear() 
                : null;
            return firstYear && value.split(",").map(v => parseInt(v.trim(), 10)).includes(firstYear);
        },
        "album-first-scrobble-years": (item, value) => {
            const firstYear = albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.firstscrobble
                ? new Date(parseInt(albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`].firstscrobble, 10)).getFullYear()
                : null;
            return firstYear && value.split(",").map(v => parseInt(v.trim(), 10)).includes(firstYear);
        },
        "track-first-scrobble-years": (item, value) => {
            const firstYear = trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.firstscrobble
                ? new Date(parseInt(trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`].firstscrobble, 10)).getFullYear()
                : null;
            return firstYear && value.split(",").map(v => parseInt(v.trim(), 10)).includes(firstYear);
        },

        // Filters based on detailed data

        "artist-listeners-min": (item, value) => artistDataMap[item.Artist.toLowerCase()]?.listeners >= parseInt(value, 10),
        "artist-listeners-max": (item, value) => artistDataMap[item.Artist.toLowerCase()]?.listeners <= parseInt(value, 10),
        "artist-global-scrobbles-min": (item, value) => artistDataMap[item.Artist.toLowerCase()]?.playcount >= parseInt(value, 10),
        "artist-global-scrobbles-max": (item, value) => artistDataMap[item.Artist.toLowerCase()]?.playcount <= parseInt(value, 10),
    
        "album-listeners-min": (item, value) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners >= parseInt(value, 10),
        "album-listeners-max": (item, value) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners <= parseInt(value, 10),
        "album-global-scrobbles-min": (item, value) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount >= parseInt(value, 10),
        "album-global-scrobbles-max": (item, value) => albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount <= parseInt(value, 10),
    
        "track-listeners-min": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners >= parseInt(value, 10),
        "track-listeners-max": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners <= parseInt(value, 10),
        "track-global-scrobbles-min": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount >= parseInt(value, 10),
        "track-global-scrobbles-max": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount <= parseInt(value, 10),
    
        "track-duration-min": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.duration / 1000 >= parseInt(value, 10),
        "track-duration-max": (item, value) => trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.duration / 1000 <= parseInt(value, 10),

        "artist-tags": (item, value) => {
            const detailedArtist = artistDataMap[item.Artist.toLowerCase()];
            if (!detailedArtist) return false;  // or true if you want to ignore missing details
            return matchFilter(value, detailedArtist.tags || []);
            },

        // Time-based filters

        "year": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedYears = value.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            const date = new Date(parseInt(item.Date, 10));
            return selectedYears.length === 0 || selectedYears.includes(date.getFullYear());
        },
    
        "month": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedMonths = getSelectedValues("month").map(Number);
            const month = new Date(parseInt(item.Date, 10)).getMonth() + 1;
            return selectedMonths.length === 0 || selectedMonths.includes(month);
        },
    
        "day-of-month": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedDays = value.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            const day = new Date(parseInt(item.Date, 10)).getDate();
            return selectedDays.length === 0 || selectedDays.includes(day);
        },
    
        "weekday": (item, value) => {
            if (!item.Date || isNaN(item.Date)) return false;
            const selectedWeekdays = getSelectedValues("weekday").map(Number);
            const weekday = new Date(parseInt(item.Date, 10)).getDay();
            return selectedWeekdays.length === 0 || selectedWeekdays.includes(weekday);
        },

        "last-n-days": (item, value) => {
            const now = Date.now();
            return now - parseInt(item.Date) <= value * 86400000;
        },

        "date-range-start": (item, value) => {
            const startTime = new Date(value).getTime();
            return item.Date >= startTime;
        },
        "date-range-end": (item, value) => {
            const endTime = new Date(value).getTime() + 86400000; // Include the whole day
            return item.Date < endTime;
        },

        "scrobble-order-from": (item, value) => item.order >= parseInt(value, 10),
        "scrobble-order-to": (item, value) => item.order <= parseInt(value, 10)
    };

    activeFilters.forEach(filter => {
        if (filterFunctions[filter.id]) {
            filteredData = filteredData.filter(item => filterFunctions[filter.id](item, filter.value));
        }
    });

    if (sortingBasis === 'scrobbles') {
        // Default grouping by scrobbles (using count aggregation)
        if (entityType === 'track') {
            const trackGroups = {};
            filteredData.forEach(track => {
                // Group by Artist + Track (ignoring album differences)
                const key = `${track.Artist.toLowerCase()} - ${track.Track.toLowerCase()}`;
                if (!trackGroups[key]) {
                    trackGroups[key] = { ...track, count: 0, albumCounts: {} };
                }
                trackGroups[key].count++;
                // Count album occurrences to show the most played album for the track.
                const albumName = track.Album;
                if (!trackGroups[key].albumCounts[albumName]) {
                    trackGroups[key].albumCounts[albumName] = 0;
                }
                trackGroups[key].albumCounts[albumName]++;
            });
            filteredData = Object.values(trackGroups);
        } else if (entityType === 'album') {
            const albumGroups = {};
            filteredData.forEach(track => {
                // Group by Album + Artist
                const key = `${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`;
                if (!albumGroups[key]) {
                    albumGroups[key] = { name: track.Album, artist: track.Artist, count: 0, tracks: [] };
                }
                albumGroups[key].count++;
                albumGroups[key].tracks.push(track);
            });
            filteredData = Object.values(albumGroups);
        } else if (entityType === 'artist') {
            const artistGroups = {};
            filteredData.forEach(track => {
                // Group by Artist
                const key = track.Artist.toLowerCase();
                if (!artistGroups[key]) {
                    artistGroups[key] = { name: track.Artist, count: 0, tracks: [] };
                }
                artistGroups[key].count++;
                artistGroups[key].tracks.push(track);
            });
            filteredData = Object.values(artistGroups);
        }
        // For default grouping (scrobbles), sort by count descending.
        filteredData.sort((a, b) => (b.count || 0) - (a.count || 0));
    } else if (sortingBasis === 'separate-days') {
        filteredData = calculateSeparateScrobbles(filteredData, 'day', entityType);
        filteredData.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'separate-weeks') {
        filteredData = calculateSeparateScrobbles(filteredData, 'week', entityType);
        filteredData.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'separate-months') {
        filteredData = calculateSeparateScrobbles(filteredData, 'month', entityType);
        filteredData.sort((a, b) => b.count - a.count);
    } else if (sortingBasis === 'consecutive-scrobbles') {
        filteredData = calculateConsecutiveScrobbles(filteredData, entityType);
        filteredData.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'consecutive-days') {
        filteredData = calculateConsecutivePeriods(filteredData, 'day', entityType);
        filteredData.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'consecutive-weeks') {
        filteredData = calculateConsecutivePeriods(filteredData, 'week', entityType);
        filteredData.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'consecutive-months') {
        filteredData = calculateConsecutivePeriods(filteredData, 'month', entityType);
        filteredData.sort((a, b) => b.maxConsecutive - a.maxConsecutive);
    } else if (sortingBasis === 'highest-listening-percentage') {
        filteredData = calculateListeningPercentage(filteredData, entityType);
        filteredData.sort((a, b) => b.listeningPercentage - a.listeningPercentage);
    } else if (sortingBasis === 'time-spent-listening') {
        filteredData = calculateListeningDuration(filteredData, entityType);
        filteredData.sort((a, b) => b.listeningDuration - a.listeningDuration);
    }

    if (entityType === "track") {
        // For example, limit to 1 track per artist:
        filteredData = applyTracksPerEntityFilter(filteredData, maxPerArtist);
        displayTopTracks(filteredData);
    } else if (entityType === "album") {
        displayTopAlbums(filteredData);
    } else if (entityType === "artist") {
        displayTopArtists(filteredData);
    }

    // Update the results header based on the selected entity type.
    const resultsHeader = document.querySelector("#results-section h2");
    if (entityType === "track") {
    resultsHeader.textContent = "Top Tracks";
    } else if (entityType === "album") {
    resultsHeader.textContent = "Top Albums";
    } else if (entityType === "artist") {
    resultsHeader.textContent = "Top Artists";
    }

    updateActiveFilters();
}

// Attach event listeners to filter inputs
document.querySelectorAll(".filters").forEach(filter => {
    filter.addEventListener("input", (event) => {
        addFilter(event.target.id, event.target.value);
    });
});

// Function to update the active filters display
function updateActiveFilters() {
    const activeFiltersDiv = document.getElementById("active-filters");
    activeFiltersDiv.innerHTML = ""; // Clear previous filters

    const filters = [

        { id: "entity-type", label: "Entity type", isSelect: true },
        { id: "sorting-basis", label: "Sorting basis", isSelect: true },

        { id: "max-per-artist", label: "Max tracks per artist" },

        // Artist filters

        { id: "artist-initial", label: "Artist initial" },
        { id: "artist-name", label: "Artist name" },
        { id: "artist-includes", label: "Artist name includes" },
        { id: "artist-excludes", label: "Artist name excludes" },
        { id: "artist-name-length-min", label: "Artist name length (min)" },
        { id: "artist-name-length-max", label: "Artist name length (max)" },
        { id: "artist-word-count-min", label: "Artist word count (min)" },
        { id: "artist-word-count-max", label: "Artist word count (max)" },

        { id: "artist-scrobble-count-min", label: "Artist user scrobbles (min)" },
        { id: "artist-scrobble-count-max", label: "Artist user scrobbles (max)" },
        { id: "artist-rank-min", label: "Artist rank (min)" },
        { id: "artist-rank-max", label: "Artist rank (max)" },
        { id: "artist-track-count-min", label: "Artist track count (min)" },
        { id: "artist-track-count-max", label: "Artist track count (max)" },
        { id: "artist-first-scrobble-years", label: "Artist first scrobble years" },

        { id: "artist-listeners-min", label: "Artist listeners (min)" },
        { id: "artist-listeners-max", label: "Artist listeners (max)" },
        { id: "artist-global-scrobbles-min", label: "Artist global scrobbles (min)" },
        { id: "artist-global-scrobbles-max", label: "Artist global scrobbles (max)" },
        { id: "artist-tags", label: "Artist tags" },

        // Album filters

        { id: "album-initial", label: "Album initial" },
        { id: "album-name", label: "Album name" },
        { id: "album-includes", label: "Album name includes" },
        { id: "album-excludes", label: "Album name excludes" },       
        { id: "album-name-length-min", label: "Album name length (min)" },
        { id: "album-name-length-max", label: "Album name length (max)" },
        { id: "album-word-count-min", label: "Album word count (min)" },
        { id: "album-word-count-max", label: "Album word count (max)" },

        { id: "album-scrobble-count-min", label: "Album user scrobbles (min)" },
        { id: "album-scrobble-count-max", label: "Album user scrobbles (max)" },
        { id: "album-rank-min", label: "Album rank (min)" },
        { id: "album-rank-max", label: "Album rank (max)" },
        { id: "album-track-count-min", label: "Album track count (min)" },
        { id: "album-track-count-max", label: "Album track count (max)" },
        { id: "album-first-scrobble-years", label: "Album first scrobble years" },

        { id: "album-listeners-min", label: "Album listeners (min)" },
        { id: "album-listeners-max", label: "Album listeners (max)" },
        { id: "album-global-scrobbles-min", label: "Album global scrobbles (min)" },
        { id: "album-global-scrobbles-max", label: "Album global scrobbles (max)" },

        // Track filters

        { id: "track-initial", label: "Track initial" },
        { id: "track-name", label: "Track title" },
        { id: "track-includes", label: "Track title includes" },
        { id: "track-excludes", label: "Track title excludes" },
        { id: "track-name-length-min", label: "Track title length (min)" },
        { id: "track-name-length-max", label: "Track title length (max)" },
        { id: "track-word-count-min", label: "Track word count (min)" },
        { id: "track-word-count-max", label: "Track word count (max)" },

        { id: "track-scrobble-count-min", label: "Track user scrobbles (min)" },
        { id: "track-scrobble-count-max", label: "Track user scrobbles (max)" },
        { id: "track-rank-min", label: "Track rank (min)" },
        { id: "track-rank-max", label: "Track rank (max)" },
        { id: "track-first-scrobble-years", label: "Track first scrobble years" },

        { id: "track-listeners-min", label: "Track listeners (min)" },
        { id: "track-listeners-max", label: "Track listeners (max)" },
        { id: "track-global-scrobbles-min", label: "Track global scrobbles (min)" },
        { id: "track-global-scrobbles-max", label: "Track global scrobbles (max)" },
        { id: "track-duration-min", label: "Track duration (min)" },
        { id: "track-duration-max", label: "Track duration (max)" },

        // Time filters

        { id: "year", label: "Year" },
        { id: "month", label: "Month", isSelect: true },
        { id: "day-of-month", label: "Day of month" },
        { id: "weekday", label: "Weekday", isSelect: true },
        { id: "date-range-start", label: "Date range start" },
        { id: "date-range-end", label: "Date range end" },
        { id: "last-n-days", label: "Last n days" },
        { id: "scrobble-order-from", label: "Scrobble order (min)" },
        { id: "scrobble-order-to", label: "Scrobble order (max)" }
    ];

    filters.forEach(filter => {
        const element = document.getElementById(filter.id);
        if (!element) return; // Skip if element is not found
        // If it's a select (multi-select), join the selected options; otherwise, take the value.
        let value = filter.isSelect 
            ? Array.from(element.selectedOptions).map(option => option.text).join(", ") 
            : element.value;
        if (value.trim() !== "") {
            const filterLabel = document.createElement("div");
            filterLabel.classList.add("filter-label");
            filterLabel.textContent = `${filter.label}: ${value}`;
            activeFiltersDiv.appendChild(filterLabel);
        }
    });
}

function resetFilters() {
    // Reset all input and select elements within #filters-section
    document.querySelectorAll("#filters-section input, #filters-section select").forEach(element => {
        element.value = "";
    });
    
    // Clear the activeFilters array (using splice or reassigning an empty array)
    activeFilters.length = 0;
    
    // Set default values for sorting basis and entity type
    document.getElementById("sorting-basis").value = "scrobbles";
    document.getElementById("entity-type").value = "track";
    
    // Display the full track list and update active filters display
    applyFilters();
    updateActiveFilters();
}

// Event listener for Apply Filters button
document.getElementById("apply-filters").addEventListener("click", applyFilters);

// Event listener for Reset Filters button
document.getElementById("reset-filters").addEventListener("click", resetFilters);

document.querySelectorAll('.dropdown').forEach(dropdown => {
    dropdown.addEventListener('click', function(event) {
        const content = this.querySelector('.dropdown-content');
        content.classList.toggle('open');
        
        // Prevent scrolling of the body when the dropdown is open
        if (content.classList.contains('open')) {
            document.body.classList.add('no-scroll');
        } else {
            document.body.classList.remove('no-scroll');
        }
        
        // Prevent the dropdown click from propagating and causing body scroll
        event.stopPropagation();
    });
});

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const openDropdown = document.querySelector('.dropdown-content.open');
    if (openDropdown && !openDropdown.contains(event.target)) {
        openDropdown.classList.remove('open');
        document.body.classList.remove('no-scroll');
    }
});
