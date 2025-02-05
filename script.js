// Global variables
let allTracks = [];
let lastfmData = [];
let artistsData = []; // [{ name, listeners, playcount, debutYear }]
let albumsData = [];  // [{ title, artist, releaseDate, playcount }]
let tracksData = [];  // [{ title, album, listeners, playcount }]
let topArtists = [];
let topAlbums = [];
let topTracks = [];
const DB_NAME = 'lastfmDataDB';
const DB_VERSION = 1;
const STORE_NAME = 'userData';
const API_KEY = "edbd779d54b373b8710af5c346148ae3";
const resultsDiv = document.getElementById("results");
const loadingDiv = document.getElementById("loading-stats");

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
	const timezoneOffset = new Date().getTimezoneOffset() / 60; // in hours

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
			adjustedDate = (timestamp * 1000 + timezoneOffset * 3600000).toString(); // Adjust by hours (3600 seconds per hour)
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
					adjustedDate = (timestamp * 1000 + timezoneOffset * 3600000).toString(); // Adjust by hours (3600 seconds per hour)
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
    const timezoneOffset = new Date().getTimezoneOffset() / 60; // in hours
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
        const ts = parseInt(track.date.uts, 10);
        // Adjust by timezone offset (3600000 ms per hour)
        const adjustedTimestamp = ts * 1000 + timezoneOffset * 3600000;
  
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

async function fetchAllArtistDetails(artists, delay = 10) {
    const results = [];
    // Limit to the top 250 artists (or whichever number you choose)
    const limitedArtists = artists.slice(0, 250);
    
    for (const artist of limitedArtists) {
      const details = await fetchArtistDetails(artist.name);
      results.push(details);
      // Wait a little between requests to help avoid rate limiting.
      await sleep(delay);
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

async function fetchAllAlbumDetails(albums, delay = 10) {
    const results = [];
    // Limit to the top 500 albums (or whichever number you choose)
    const limitedAlbums = albums.slice(0, 500);
    
    for (const album of limitedAlbums) {
      const details = await fetchAlbumDetails(album);
      results.push(details);
      // Wait a little between requests.
      await sleep(delay);
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
				return null;
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

async function fetchAllTrackDetails(tracks) {
	console.log("Fetching track details...");

	const results = [];
	for (const track of tracks) {
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

	// ✅ ALWAYS re-fetch the top stats to update rankings and counts!
	topArtists = await fetchTopArtists(username);
	topAlbums = await fetchTopAlbums(username);
	topTracks = await fetchTopTracks(username);

	// Objects to track earliest scrobbles
	const firstScrobbles = { artists: {}, albums: {}, tracks: {} };

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
            user_scrobbles: parseInt(artist.user_scrobbles, 10) || 0
        };
    });
    
    const newAlbumsData = topAlbums.map((album, index) => {
        const key = `${album.name.trim().toLowerCase()}_${album.artist.trim().toLowerCase()}`;
        return {
            name: album.name,
            artist: album.artist,
            rank: index + 1,
            firstscrobble: firstScrobbles.albums?.[key] ?? null,
            user_scrobbles: parseInt(album.user_scrobbles, 10) || 0
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
    
    // Merge new data into the existing arrays (only updating the keys specified)
    artistsData = mergeData(artistsData, newArtistsData, item => item.name.trim().toLowerCase());
    albumsData = mergeData(albumsData, newAlbumsData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);
    tracksData = mergeData(tracksData, newTracksData, 
        item => `${item.name.trim().toLowerCase()}_${item.artist.trim().toLowerCase()}`);
    
    console.log("Merged artistsData:", artistsData);
	console.log("Merged albumsData:", albumsData);
	console.log("Merged tracksData:", tracksData);

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
	if (selectedArtists.length < 250) {
		selectedArtists = topArtists.slice(0, 250);
	}
	const fetchedArtists = await fetchAllArtistDetails(selectedArtists, 250);
	console.log("Fetched artist details:", fetchedArtists);

	// For Albums: choose those with >10 scrobbles or the top 500 (whichever is more)
	let selectedAlbums = topAlbums.filter(album => album.playcount > 10);
	if (selectedAlbums.length < 500) {
		selectedAlbums = topAlbums.slice(0, 500);
	}
	const fetchedAlbums = await fetchAllAlbumDetails(selectedAlbums, 250);
	console.log("Fetched album details:", fetchedAlbums);

	// For Tracks: choose those with >5 scrobbles or the top 1000 (whichever is more)
	let selectedTracks = topTracks.filter(track => track.playcount > 5);
	if (selectedTracks.length < 1000) {
		selectedTracks = topTracks.slice(0, 1000);
	}
	const fetchedTracks = await fetchAllTrackDetails(selectedTracks, 250);
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

		// ✅ Iterate over allTracks to determine first scrobbles
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

			// Add to raw_data
			raw_data.push({
				artist: track.Artist,
				album: track.Album,
				track: track.Track,
				date: uts
			});
		});

		// ✅ Sort by Date (oldest first)
		raw_data.sort((a, b) => a.date - b.date);

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
                firstscrobble: firstScrobbles.artists?.[artistKey] ?? null, // Use optional chaining & default to null
                user_scrobbles: parseInt(artist.user_scrobbles, 10) || 0
            };
        }).filter(Boolean); // Remove null values
        
        
        albumsData = topAlbums.map((album, index) => {
            if (!album.name || !album.artist) return null; // Skip bad entries
        
            const albumKey = `${album.name.trim().toLowerCase()}_${album.artist.trim().toLowerCase()}`;
            return {
                name: album.name,
                artist: album.artist,
                rank: index + 1,
                firstscrobble: firstScrobbles.albums?.[albumKey] ?? null,
                user_scrobbles: parseInt(album.user_scrobbles, 10) || 0
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
                user_scrobbles: parseInt(track.user_scrobbles, 10) || 0
            };
        }).filter(Boolean);
                

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
    const headers = lines[0].split(';').map(header => header.trim());

    // Find the date header and rename it to 'Date'
    const dateHeader = headers.find(header => header.startsWith('Date#'));
    const renamedHeaders = headers.map(header => (header === dateHeader ? 'Date' : header));

    // Get the timezone offset from the dropdown
    const timezoneOffset = parseInt(document.getElementById("timezone").value) || 0;

    return lines.slice(1).map(line => {
        const values = line.match(/(".*?"|[^;]+)(?=;|$)/g)
            .map(val => val.replace(/"/g, '').trim());

        const track = renamedHeaders.reduce((obj, header, index) => {
            obj[header] = values[index] || "";
            return obj;
        }, {});

        // Adjust the date based on the timezone offset
        if (track.Date) {
            const timestamp = parseInt(track.Date);
            if (!isNaN(timestamp)) {
                track.Date = (timestamp + timezoneOffset * 3600000).toString();
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

/**
 * Calculate the maximum number of consecutive scrobbles for an entity.
 * @param {Array} tracks - Array of track objects.
 * @param {string} [entityType='track'] - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with consecutive scrobble counts and timestamps.
 */
function calculateConsecutiveScrobbles(tracks, entityType = 'track') {
    // Define grouping key based on entityType.
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
        // When the group key changes (or first element), reset the current consecutive count.
        if (index === 0 || groupKeyFunc(array[index - 1]) !== key) {
            acc[key].currentConsecutive = 1;
            acc[key].currentStartTime = track.Date;
        } else {
            acc[key].currentConsecutive++;
        }
        if (acc[key].currentConsecutive > acc[key].maxConsecutive) {
            acc[key].maxConsecutive = acc[key].currentConsecutive;
            acc[key].startTime = acc[key].currentStartTime;
            acc[key].endTime = track.Date;
        }
        return acc;
    }, {});

    return Object.values(groups);
}


/**
 * Calculate the maximum consecutive periods (day/week/month) for an entity.
 * @param {Array} tracks - Array of track objects.
 * @param {string} period - The period to calculate ('day', 'week', 'month').
 * @param {string} [entityType='track'] - Grouping level: 'track', 'album', or 'artist'.
 * @returns {Array} - Array of grouped objects with maximum consecutive period count and timestamps.
 */
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
        const groupTracks = tracks.filter(t => groupKeyFunc(t) === key);
        const periodsSet = new Set();

        groupTracks.forEach(track => {
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
        let maxConsecutive = 0, currentConsecutive = 0, lastPeriod = null, startTime = null, endTime = null;
        sortedPeriods.forEach(currentPeriod => {
            if (lastPeriod !== null && isNextPeriod(lastPeriod, currentPeriod, period)) {
                currentConsecutive++;
                const matchingTrack = groupTracks.find(t => {
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
                    return pKey === currentPeriod;
                });
                endTime = matchingTrack ? matchingTrack.Date : null;
            } else {
                if (currentConsecutive > maxConsecutive) {
                    maxConsecutive = currentConsecutive;
                    results[key] = {
                        maxConsecutive,
                        startTime,
                        endTime
                    };
                }
                currentConsecutive = 1;
                const matchingTrack = groupTracks.find(t => {
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
                    return pKey === currentPeriod;
                });
                startTime = matchingTrack ? matchingTrack.Date : null;
                endTime = startTime;
            }
            lastPeriod = currentPeriod;
        });
        if (currentConsecutive > maxConsecutive) {
            maxConsecutive = currentConsecutive;
            results[key] = {
                maxConsecutive,
                startTime,
                endTime
            };
        }
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

        if (sortingBasis === 'separate-days') {
            additionalInfo = `Different days: ${track.count}`;
        } else if (sortingBasis === 'separate-weeks') {
            additionalInfo = `Different weeks: ${track.count}`;
        } else if (sortingBasis === 'separate-months') {
            additionalInfo = `Different months: ${track.count}`;
        } else if (sortingBasis === 'consecutive-scrobbles') {
            additionalInfo = `Max consecutive scrobbles: ${track.maxConsecutive}<br>Start: ${new Date(parseInt(track.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(track.endTime)).toLocaleString()}`;
        } else if (sortingBasis === 'consecutive-days') {
            additionalInfo = `Max consecutive days: ${track.maxConsecutive}<br>Start: ${new Date(parseInt(track.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(track.endTime)).toLocaleString()}`;
        } else if (sortingBasis === 'consecutive-weeks') {
            additionalInfo = `Max consecutive weeks: ${track.maxConsecutive}<br>Start: ${new Date(parseInt(track.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(track.endTime)).toLocaleString()}`;
        } else if (sortingBasis === 'consecutive-months') {
            additionalInfo = `Max consecutive months: ${track.maxConsecutive}<br>Start: ${new Date(parseInt(track.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(track.endTime)).toLocaleString()}`;
        } else {
            additionalInfo = `Scrobbles: ${track.count}`;
        }

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

        if (sortingBasis === 'separate-days') {
            additionalInfo = `Different days: ${album.count}`;
        } else if (sortingBasis === 'separate-weeks') {
            additionalInfo = `Different weeks: ${album.count}`;
        } else if (sortingBasis === 'separate-months') {
            additionalInfo = `Different months: ${album.count}`;
        } else if (sortingBasis === 'consecutive-scrobbles') {
            additionalInfo = `Max consecutive scrobbles: ${album.maxConsecutive}<br>Start: ${new Date(parseInt(album.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(album.endTime)).toLocaleString()}`;
        } else if (sortingBasis === 'consecutive-days') {
            additionalInfo = `Max consecutive days: ${album.maxConsecutive}<br>Start: ${new Date(parseInt(album.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(album.endTime)).toLocaleString()}`;
        } else if (sortingBasis === 'consecutive-weeks') {
            additionalInfo = `Max consecutive weeks: ${album.maxConsecutive}<br>Start: ${new Date(parseInt(album.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(album.endTime)).toLocaleString()}`;
        } else if (sortingBasis === 'consecutive-months') {
            additionalInfo = `Max consecutive months: ${album.maxConsecutive}<br>Start: ${new Date(parseInt(album.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(album.endTime)).toLocaleString()}`;
        } else {
            additionalInfo = `Scrobbles: ${album.count}`;
        }

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

        if (sortingBasis === 'separate-days') {
            additionalInfo = `Different days: ${artist.count}`;
        } else if (sortingBasis === 'separate-weeks') {
            additionalInfo = `Different weeks: ${artist.count}`;
        } else if (sortingBasis === 'separate-months') {
            additionalInfo = `Different months: ${artist.count}`;
        } else if (sortingBasis === 'consecutive-scrobbles') {
            additionalInfo = `Max consecutive scrobbles: ${artist.maxConsecutive}<br>Start: ${new Date(parseInt(artist.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(artist.endTime)).toLocaleString()}`;
        } else if (sortingBasis === 'consecutive-days') {
            additionalInfo = `Max consecutive days: ${artist.maxConsecutive}<br>Start: ${new Date(parseInt(artist.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(artist.endTime)).toLocaleString()}`;
        } else if (sortingBasis === 'consecutive-weeks') {
            additionalInfo = `Max consecutive weeks: ${artist.maxConsecutive}<br>Start: ${new Date(parseInt(artist.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(artist.endTime)).toLocaleString()}`;
        } else if (sortingBasis === 'consecutive-months') {
            additionalInfo = `Max consecutive months: ${artist.maxConsecutive}<br>Start: ${new Date(parseInt(artist.startTime)).toLocaleString()}<br>End: ${new Date(parseInt(artist.endTime)).toLocaleString()}`;
        } else {
            additionalInfo = `Scrobbles: ${artist.count}`;
        }

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

function getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

/**
 * Checks if the artist's tag array matches the filter input.
 * 
 * - If the input string contains a semicolon, it is split into groups.
 *   Each group is then split by comma. The artist is a match if it has
 *   all tags from at least one of those groups (AND logic per group).
 * 
 * - If the input string does NOT contain a semicolon, it is split by comma
 *   and the artist is a match if it has at least one of those tags (OR logic).
 *
 * @param {string} filterInput - The string from the input field.
 * @param {Array<string>} artistTags - The array of tags for the artist (all lowercased).
 * @return {boolean} True if the artist matches the filter, false otherwise.
 */
function matchTags(filterInput, artistTags) {
    // Normalize the filter input to lower case
    const normalize = (str) => str.trim().toLowerCase().replace(/-/g, ''); // normalize by lowercasing and removing hyphens
    const normalizedArtistTags = artistTags.map(normalize);

    const input = filterInput.trim().toLowerCase();
    if (!input) return true; // If empty, consider it a match

    if (input.indexOf(';') !== -1) {
        // Split by semicolon to get separate groups (AND logic)
        const groups = input.split(';').map(group =>
            group.split(',').map(tag => normalize(tag)).filter(tag => tag !== '')
        );

        // Check that each group has at least one match (OR logic inside each group)
        return groups.every(group => group.some(tag => normalizedArtistTags.includes(tag)));
    } else {
        // If no semicolon, just use OR logic for comma-separated tags
        const tags = input.split(',').map(tag => normalize(tag)).filter(tag => tag !== '');
        return tags.some(tag => normalizedArtistTags.includes(tag));
    }
}

function applyFilters() {
    // Retrieve new controls:
    const sortingBasis = document.getElementById("sorting-basis").value; // e.g., "scrobbles"
    const entityType = document.getElementById("entity-type").value;       // "track", "album", or "artist"
    const listLength = parseInt(document.getElementById("list-length").value) || Infinity;

    // Retrieve other filter values (converting to lower case when applicable)
    const artistName = document.getElementById("artist-name").value.toLowerCase().trim();
    const artistInitial = document.getElementById("artist-initial").value.toLowerCase().trim();
    const artistIncludes = document.getElementById("artist-includes").value.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
    const artistExcludes = document.getElementById("artist-excludes").value.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);

    const albumName = document.getElementById("album-name").value.toLowerCase().trim();
    const albumInitial = document.getElementById("album-initial").value.toLowerCase().trim();
    const albumIncludes = document.getElementById("album-includes").value.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
    const albumExcludes = document.getElementById("album-excludes").value.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);

    const trackName = document.getElementById("track-name").value.toLowerCase().trim();
    const trackInitial = document.getElementById("track-initial").value.toLowerCase().trim();
    const trackIncludes = document.getElementById("track-includes").value.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
    const trackExcludes = document.getElementById("track-excludes").value.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);

    // Time filters:
    const yearInput = document.getElementById("year").value.trim();
    const selectedYears = yearInput.length > 0 
        ? yearInput.split(',').map(y => parseInt(y.trim(), 10)).filter(num => !isNaN(num))
        : [];
    const month = Array.from(document.getElementById("month").selectedOptions).map(option => parseInt(option.value));
    const dayInput = document.getElementById("day-of-month").value.trim();
    const selectedDays = dayInput.length > 0 
        ? dayInput.split(',').map(d => parseInt(d.trim(), 10)).filter(num => !isNaN(num))
        : [];
    const weekday = Array.from(document.getElementById("weekday").selectedOptions)
                     .map(option => parseInt(option.value, 10));
    const lastNDays = parseInt(document.getElementById("last-n-days").value) || 0;

    // Name length filters:
    const artistNameLengthMin = parseInt(document.getElementById("artist-name-length-min").value) || 0;
    const artistNameLengthMax = parseInt(document.getElementById("artist-name-length-max").value) || Infinity;
    const albumNameLengthMin = parseInt(document.getElementById("album-name-length-min").value) || 0;
    const albumNameLengthMax = parseInt(document.getElementById("album-name-length-max").value) || Infinity;
    const trackNameLengthMin = parseInt(document.getElementById("track-name-length-min").value) || 0;
    const trackNameLengthMax = parseInt(document.getElementById("track-name-length-max").value) || Infinity;

    // Global stats filters:
    const artistListenersMin = parseInt(document.getElementById("artist-listeners-min").value) || 0;
    const artistListenersMax = parseInt(document.getElementById("artist-listeners-max").value) || Infinity;
    const artistScrobblesMin = parseInt(document.getElementById("artist-scrobbles-min").value) || 0;
    const artistScrobblesMax = parseInt(document.getElementById("artist-scrobbles-max").value) || Infinity;

    const albumListenersMin = parseInt(document.getElementById("album-listeners-min").value) || 0;
    const albumListenersMax = parseInt(document.getElementById("album-listeners-max").value) || Infinity;
    const albumScrobblesMin = parseInt(document.getElementById("album-scrobbles-min").value) || 0;
    const albumScrobblesMax = parseInt(document.getElementById("album-scrobbles-max").value) || Infinity;

    const trackListenersMin = parseInt(document.getElementById("track-listeners-min").value) || 0;
    const trackListenersMax = parseInt(document.getElementById("track-listeners-max").value) || Infinity;
    const trackScrobblesMin = parseInt(document.getElementById("track-scrobbles-min").value) || 0;
    const trackScrobblesMax = parseInt(document.getElementById("track-scrobbles-max").value) || Infinity;
    const trackDurationMin = (parseInt(document.getElementById("track-duration-min").value, 10) || 0) * 1000;
    const trackDurationMax = (parseInt(document.getElementById("track-duration-max").value, 10) || Infinity) * 1000;

    // User scrobble filters:
    const artistScrobbleCountMin = parseInt(document.getElementById("artist-scrobble-count-min").value) || 0;
    const artistScrobbleCountMax = parseInt(document.getElementById("artist-scrobble-count-max").value) || Infinity;
    const albumScrobbleCountMin = parseInt(document.getElementById("album-scrobble-count-min").value) || 0;
    const albumScrobbleCountMax = parseInt(document.getElementById("album-scrobble-count-max").value) || Infinity;
    const trackScrobbleCountMin = parseInt(document.getElementById("track-scrobble-count-min").value) || 0;
    const trackScrobbleCountMax = parseInt(document.getElementById("track-scrobble-count-max").value) || Infinity;

    // Ranking filters:
    const artistRankMin = parseInt(document.getElementById("artist-rank-min").value) || 0;
    const artistRankMax = parseInt(document.getElementById("artist-rank-max").value) || Infinity;
    const albumRankMin = parseInt(document.getElementById("album-rank-min").value) || 0;
    const albumRankMax = parseInt(document.getElementById("album-rank-max").value) || Infinity;
    const trackRankMin = parseInt(document.getElementById("track-rank-min").value) || 0;
    const trackRankMax = parseInt(document.getElementById("track-rank-max").value) || Infinity;

    // Word count filters (for names; count words as number of spaces + 1)
    const artistWordCountMin = parseInt(document.getElementById("artist-word-count-min").value) || 0;
    const artistWordCountMax = parseInt(document.getElementById("artist-word-count-max").value) || Infinity;
    const albumWordCountMin = parseInt(document.getElementById("album-word-count-min").value) || 0;
    const albumWordCountMax = parseInt(document.getElementById("album-word-count-max").value) || Infinity;
    const trackWordCountMin = parseInt(document.getElementById("track-word-count-min").value) || 0;
    const trackWordCountMax = parseInt(document.getElementById("track-word-count-max").value) || Infinity;

    const getFirstScrobbleYears = (id) => {
        const rawInput = document.getElementById(id).value.trim();
    
        const parsedYears = rawInput.split(",")
            .map(year => parseInt(year.trim(), 10))
            .filter(Number.isInteger);
    
        return parsedYears;
    };
    
    const artistFirstScrobbleYears = getFirstScrobbleYears("artist-first-scrobble-years");
    const albumFirstScrobbleYears = getFirstScrobbleYears("album-first-scrobble-years");
    const trackFirstScrobbleYears = getFirstScrobbleYears("track-first-scrobble-years");

    const genreCountryInput = document.getElementById("artist-genre-country").value;

    // Helper functions:
    const includesAny = (text, words) => words.length === 0 || words.some(word => text.includes(word));
    const excludesAll = (text, words) => words.length === 0 || words.every(word => !text.includes(word));

    // Calculate word count by splitting on whitespace.
    const wordCount = text => 
        text.split(/\s+/).filter(word => word && word !== "-").length;    

    // Function to apply time filters on a Date object.
    const dateMatches = (date) => {
        const yearMatches = selectedYears.length === 0 || selectedYears.includes(date.getFullYear());
        const monthMatches = month.length === 0 || month.includes(date.getMonth() + 1);
        const dayOfMonthMatches = selectedDays.length === 0 || selectedDays.includes(date.getDate());
        const weekdayMatches = weekday.length === 0 || weekday.includes(date.getDay());
        const lastNDaysMatches = !lastNDays || date.getTime() >= (Date.now() - lastNDays * 24 * 60 * 60 * 1000);

        return yearMatches && monthMatches && dayOfMonthMatches && weekdayMatches && lastNDaysMatches;
    };

    // ---- 1. Filter tracks from allTracks (track-level filtering) ----
    const filteredTracks = allTracks.filter(track => {

        const artist = track.Artist.toLowerCase();
        const album = track.Album.toLowerCase();
        const trackTitle = track.Track.toLowerCase();

        // Look up detailed stats from global arrays:
        const trackData = tracksData.find(t =>
            t && t.name && t.name.toLowerCase() === trackTitle &&
            t.artist && t.artist.toLowerCase() === artist
        );
        const artistData = artistsData.find(a => 
            a && a.name && a.name.toLowerCase() === artist
        );
        const albumData = albumsData.find(a => 
            a && a.name && a.name.toLowerCase() === album &&
            a.artist && a.artist.toLowerCase() === artist
        );

        const artistMatch = (!artistName || artist === artistName.toLowerCase()) &&
                            (!artistInitial || artist.startsWith(artistInitial.toLowerCase())) &&
                            includesAny(artist, artistIncludes) &&
                            excludesAll(artist, artistExcludes) &&
                            (artist.length >= artistNameLengthMin && artist.length <= artistNameLengthMax) &&
                            (artistData?.listeners ?? 0) >= artistListenersMin &&
                            (artistData?.listeners ?? 0) <= artistListenersMax &&
                            (artistData?.playcount ?? 0) >= artistScrobblesMin &&
                            (artistData?.playcount ?? 0) <= artistScrobblesMax &&
                            wordCount(track.Artist) >= artistWordCountMin &&
                            wordCount(track.Artist) <= artistWordCountMax &&
                            (artistScrobbleCountMin === 0 || (artistData && artistData.user_scrobbles >= artistScrobbleCountMin)) &&
                            (artistScrobbleCountMax === Infinity || (artistData && artistData.user_scrobbles <= artistScrobbleCountMax)) &&
                            (artistRankMin === 0 || (artistData && artistData.rank >= artistRankMin)) &&
                            (artistRankMax === Infinity || (artistData && artistData.rank <= artistRankMax)) &&
                            (artistFirstScrobbleYears.length === 0 || 
                                (artistData?.firstscrobble && artistFirstScrobbleYears.includes(new Date(artistData.firstscrobble).getUTCFullYear()))) &&
                            (!genreCountryInput || (artistData && matchTags(genreCountryInput, artistData.tags || [])));
                    

        const albumMatch = (!albumName || album === albumName.toLowerCase()) &&
                           (!albumInitial || album.startsWith(albumInitial.toLowerCase())) &&
                           includesAny(album, albumIncludes) &&
                           excludesAll(album, albumExcludes) &&
                           (album.length >= albumNameLengthMin && album.length <= albumNameLengthMax) &&
                           (albumData?.listeners ?? 0) >= albumListenersMin &&
                           (albumData?.listeners ?? 0) <= albumListenersMax &&
                           (albumData?.playcount ?? 0) >= albumScrobblesMin &&
                           (albumData?.playcount ?? 0) <= albumScrobblesMax &&
                            wordCount(track.Album) >= albumWordCountMin &&
                            wordCount(track.Album) <= albumWordCountMax &&
                            // (artist === albumData?.artist.toLowerCase()) &&
                            ((albumScrobbleCountMin === 0 || (albumData?.user_scrobbles ?? 0) >= albumScrobbleCountMin) &&
                             (albumScrobbleCountMax === Infinity || (albumData?.user_scrobbles ?? 0) <= albumScrobbleCountMax)) &&
                             (albumScrobbleCountMin === 0 || (trackData && trackData.user_scrobbles >= albumScrobbleCountMin)) &&
                             (albumScrobbleCountMax === Infinity || (trackData && trackData.user_scrobbles <= albumScrobbleCountMax)) &&                             
                            (albumRankMin === 0 || (albumData && albumData.rank >= albumRankMin)) &&
                            (albumRankMax === Infinity || (albumData && albumData.rank <= albumRankMax)) &&
                            (albumFirstScrobbleYears.length === 0 || 
                                (albumData?.firstscrobble && albumFirstScrobbleYears.includes(new Date(albumData.firstscrobble).getUTCFullYear())))                            
                            
        const trackMatch = (!trackName || trackTitle === trackName.toLowerCase()) &&
                           (!trackInitial || trackTitle.startsWith(trackInitial.toLowerCase())) &&
                           includesAny(trackTitle, trackIncludes) &&
                           excludesAll(trackTitle, trackExcludes) &&
                           (trackTitle.length >= trackNameLengthMin && trackTitle.length <= trackNameLengthMax) &&
                           (trackData?.listeners ?? 0) >= trackListenersMin &&
                           (trackData?.listeners ?? 0) <= trackListenersMax &&
                           (trackData?.playcount ?? 0) >= trackScrobblesMin &&
                           (trackData?.playcount ?? 0) <= trackScrobblesMax &&
                           (trackData?.duration ?? 0) >= trackDurationMin &&
                           (trackData?.duration ?? 0) <= trackDurationMax &&
                            wordCount(track.Track) >= trackWordCountMin &&
                            wordCount(track.Track) <= trackWordCountMax &&
                            (trackScrobbleCountMin === 0 || (trackData && trackData.user_scrobbles >= trackScrobbleCountMin)) &&
                            (trackScrobbleCountMax === Infinity || (trackData && trackData.user_scrobbles <= trackScrobbleCountMax)) &&                            
                            (trackRankMin === 0 || (trackData && trackData.rank >= trackRankMin)) &&
                            (trackRankMax === Infinity || (trackData && trackData.rank <= trackRankMax)) &&
                            (trackFirstScrobbleYears.length === 0 || 
                                (trackData?.firstscrobble && trackFirstScrobbleYears.includes(new Date(trackData.firstscrobble).getUTCFullYear())))                            

        const date = new Date(parseInt(track.Date));
        const timeMatch = dateMatches(date);

        return artistMatch && albumMatch && trackMatch && timeMatch;
    });

    // ---- 2. Group filtered tracks based on selected entity type ----
let filteredItems = [];
// Map the separate-X values to singular period values.
const separateMapping = {
    'separate-days': 'day',
    'separate-weeks': 'week',
    'separate-months': 'month'
};

if (separateMapping[sortingBasis]) {
    const period = separateMapping[sortingBasis]; // maps 'separate-weeks' to 'week', etc.
    filteredItems = calculateSeparateScrobbles(filteredTracks, period, entityType);
    filteredItems.sort((a, b) => b.count - a.count);
} else if (sortingBasis.startsWith('consecutive')) {
    if (sortingBasis === 'consecutive-scrobbles') {
        filteredItems = calculateConsecutiveScrobbles(filteredTracks, entityType);
    } else {
        // For consecutive-days/weeks/months, extract the period (e.g., 'days' -> 'day')
        const parts = sortingBasis.split('-'); // e.g., ['consecutive', 'days']
        // Optionally, map plural to singular (if your helper expects 'day', 'week', 'month'):
        const periodMap = { 'days': 'day', 'weeks': 'week', 'months': 'month' };
        const period = periodMap[parts[1]] || parts[1];
        filteredItems = calculateConsecutivePeriods(filteredTracks, period, entityType);
    }
    // Explicitly sort descending by maxConsecutive:
    filteredItems.sort((a, b) => (b.maxConsecutive || 0) - (a.maxConsecutive || 0));

} else {
    // Default grouping by scrobbles (using count aggregation)
    if (entityType === 'track') {
        const trackGroups = {};
        filteredTracks.forEach(track => {
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
        filteredItems = Object.values(trackGroups);
    } else if (entityType === 'album') {
        const albumGroups = {};
        filteredTracks.forEach(track => {
            // Group by Album + Artist
            const key = `${track.Album.toLowerCase()}||${track.Artist.toLowerCase()}`;
            if (!albumGroups[key]) {
                albumGroups[key] = { name: track.Album, artist: track.Artist, count: 0, tracks: [] };
            }
            albumGroups[key].count++;
            albumGroups[key].tracks.push(track);
        });
        filteredItems = Object.values(albumGroups);
    } else if (entityType === 'artist') {
        const artistGroups = {};
        filteredTracks.forEach(track => {
            // Group by Artist
            const key = track.Artist.toLowerCase();
            if (!artistGroups[key]) {
                artistGroups[key] = { name: track.Artist, count: 0, tracks: [] };
            }
            artistGroups[key].count++;
            artistGroups[key].tracks.push(track);
        });
        filteredItems = Object.values(artistGroups);
    }
    // For default grouping (scrobbles), sort by count descending.
    filteredItems.sort((a, b) => (b.count || 0) - (a.count || 0));
}

// ---- 3. Limit results by list length ----
filteredItems = filteredItems.slice(0, listLength);

// ---- 4. Display the results based on entity type ----
if (entityType === "track") {
    displayTopTracks(filteredItems);
} else if (entityType === "album") {
    displayTopAlbums(filteredItems);
} else if (entityType === "artist") {
    displayTopArtists(filteredItems);
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

updateActiveFilters(); // Update the active filters display
}


// Function to update the active filters display
function updateActiveFilters() {
    const activeFiltersDiv = document.getElementById("active-filters");
    activeFiltersDiv.innerHTML = ""; // Clear previous filters

    const filters = [
        { id: "artist-initial", label: "Artist initial" },
        { id: "artist-name", label: "Artist name" },
        { id: "artist-includes", label: "Artist name includes" },
        { id: "artist-excludes", label: "Artist name excludes" },
        { id: "album-initial", label: "Album initial" },
        { id: "album-name", label: "Album name" },
        { id: "album-includes", label: "Album name includes" },
        { id: "album-excludes", label: "Album name excludes" },
        { id: "track-initial", label: "Track initial" },
        { id: "track-name", label: "Track title" },
        { id: "track-includes", label: "Track title includes" },
        { id: "track-excludes", label: "Track title excludes" },
        { id: "year", label: "Year" },
        { id: "month", label: "Month", isSelect: true },
        { id: "day-of-month", label: "Day of month" },
        { id: "weekday", label: "Weekday", isSelect: true },
        { id: "artist-name-length-min", label: "Artist name length (min)" },
        { id: "artist-name-length-max", label: "Artist name length (max)" },
        { id: "album-name-length-min", label: "Album name length (min)" },
        { id: "album-name-length-max", label: "Album name length (max)" },
        { id: "track-name-length-min", label: "Track title length (min)" },
        { id: "track-name-length-max", label: "Track title length (max)" },
        { id: "artist-listeners-min", label: "Artist listeners (min)" },
        { id: "artist-listeners-max", label: "Artist global listeners (max)" },
        { id: "artist-scrobbles-min", label: "Artist global scrobbles (min)" },
        { id: "artist-scrobbles-max", label: "Artist scrobbles (max)" },
        { id: "album-listeners-min", label: "Album listeners (min)" },
        { id: "album-listeners-max", label: "Album listeners (max)" },
        { id: "album-scrobbles-min", label: "Album global scrobbles (min)" },
        { id: "album-scrobbles-max", label: "Album global scrobbles (max)" },
        { id: "track-listeners-min", label: "Track listeners (min)" },
        { id: "track-listeners-max", label: "Track listeners (max)" },
        { id: "track-scrobbles-min", label: "Track global scrobbles (min)" },
        { id: "track-scrobbles-max", label: "Track global scrobbles (max)" },
        { id: "track-duration-min", label: "Track duration (min)" },
        { id: "track-duration-max", label: "Track duration (max)" },
        { id: "last-n-days", label: "Last n days" },
        { id: "artist-scrobble-count-min", label: "Artist user scrobbles (min)" },
        { id: "artist-scrobble-count-max", label: "Artist user scrobbles (max)" },
        { id: "album-scrobble-count-min", label: "Album user scrobbles (min)" },
        { id: "album-scrobble-count-max", label: "Album user scrobbles (max)" },
        { id: "track-scrobble-count-min", label: "Track user scrobbles (min)" },
        { id: "track-scrobble-count-max", label: "Track user scrobbles (max)" },
        { id: "artist-rank-min", label: "Artist rank (min)" },
        { id: "artist-rank-max", label: "Artist rank (max)" },
        { id: "album-rank-min", label: "Album rank (min)" },
        { id: "album-rank-max", label: "Album rank (max)" },
        { id: "track-rank-min", label: "Track rank (min)" },
        { id: "track-rank-max", label: "Track rank (max)" },
        { id: "artist-word-count-min", label: "Artist name word count (min)" },
        { id: "artist-word-count-max", label: "Artist name word count (max)" },
        { id: "album-word-count-min", label: "Album name word count (min)" },
        { id: "album-word-count-max", label: "Album name word count (max)" },
        { id: "track-word-count-min", label: "Track title word count (min)" },
        { id: "track-word-count-max", label: "Track title word count (max)" },
        { id: "artist-first-scrobble-years", label: "Artist first scrobble years" },
        { id: "album-first-scrobble-years", label: "Album first scrobble years" },
        { id: "track-first-scrobble-years", label: "Track first scrobble years" },
        { id: "artist-genre-country", label: "Artist genre/country" }
    ];

    filters.forEach(filter => {
        const element = document.getElementById(filter.id);
        let value = filter.isSelect 
            ? Array.from(element.selectedOptions).map(option => option.text).join(", ") 
            : element.value; 
    
        if (value) {
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
