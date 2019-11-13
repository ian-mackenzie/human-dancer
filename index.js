let express = require('express');
let cors = require('cors');
let querystring = require('querystring');
let cookieParser = require('cookie-parser');
let rp = require('request-promise');
require('dotenv').config();

const client_id = process.env.SPOTIFY_CLIENT_ID;
const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
const redirect_uri = process.env.SPOTIFY_REDIRECT_URI;

let generateRandomString = (length) => {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

const stateKey = 'spotify_auth_state';

let app = express();

app.use(express.static(__dirname + '/public'))
    .use(cors())
    .use(cookieParser());

app.get('/login', (req, res) => {
    let state = generateRandomString(16);
    res.cookie(stateKey, state);

    let scope = 'user-read-private user-read-email user-library-read';
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: client_id,
            scope: scope,
            redirect_uri: redirect_uri,
            state: state
        }));
});

app.get('/callback', async (req, res) => {
    let code = req.query.code || null;
    let state = req.query.state || null;
    let storedState = req.cookies ? req.cookies[stateKey] : null;
    
    if (state === null || state !== storedState) {
        res.redirect('/#' +
            querystring.stringify({
                error: 'state_mismatch'
            }));
    } else {
        res.clearCookie(stateKey);
        let authOptions = {
            method: 'POST',
            url: 'https://accounts.spotify.com/api/token',
            form: {
                code: code,
                redirect_uri: redirect_uri,
                grant_type: 'authorization_code',
            },
            headers: {
                'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
            },
            json: true
        };
        
        try {
            let body = await rp(authOptions);
            let access_token = body.access_token;
            let refresh_token = body.refresh_token;
            let tracks = await getLikedTracks(access_token);
            let danceability = await getDanceability(tracks, access_token);
            res.redirect('/#' +
                    querystring.stringify({
                        access_token: access_token,
                        refresh_token: refresh_token,
                        danceability: Number.parseFloat(danceability*100).toFixed(2),
                        humanDancer: danceability >= .5 ? "Dancer" : "Human"
                    }));
        }
        catch(err) {
            console.log(err);
            res.redirect('/#' +
                querystring.stringify({
                    error: 'invalid_token'
                }));
        }
    }
});

let getLikedTracks = async (access_token) => {
    let tracks = [];
    let keepgoing = true;
    let options = {
        method: 'GET',
        url: 'https://api.spotify.com/v1/me/tracks?limit=50',
        headers: { 'Authorization': 'Bearer ' + access_token },
        json: true
    };

    while(keepgoing) {
        let payload = await rp(options);
        tracks = tracks.concat(payload.items.map(track => track.track.id));
        if (payload.next === null) {
            keepgoing = false;
        } else {
            options.url = payload.next;
        }
    }
    return tracks;
}

let getDanceability = async (tracks, access_token) => {
    let danceabilities = [];
    let options = {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + access_token },
        json: true
    }

    while (tracks.length > 0) {
        options.url = "https://api.spotify.com/v1/audio-features?ids=" + tracks.splice(0, Math.min(100, tracks.length)).join('%2C');
        let payload = await rp(options);
        danceabilities = danceabilities.concat(payload.audio_features.map(features => features.danceability));
    }

    let danceability = danceabilities.reduce((a,b) => a + b, 0) / danceabilities.length;
    return danceability;
}

app.get('/refresh_token', async (req, res) => {
    let refresh_token = req.query.refresh_token;
    let authOptions = {
        method: 'POST',
        url: 'https://accounts.spotify.com/api/token',
        headers: { 'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64') },
        form: {
            grant_type: 'refresh_token',
            refresh_token: refresh_token
        },
        json: true
    };

    try {
        body = await rp(authOptions);
        let access_token = body.access_token;
        res.send({
            'access_token': access_token
        });
    }
    catch (err) {
        console.log(err);
        res.redirect('/#' +
            querystring.stringify({
                error: 'invalid_token'
            }));
    }
});

console.log('listening on 8888');
app.listen(process.env.PORT);
