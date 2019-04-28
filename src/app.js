'use strict';

const apiai = require('apiai');
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');

const SparkBot = require('./sparkbot');
const SparkBotConfig = require('./sparkbotconfig');

const REST_PORT = (process.env.PORT || 5000);
const DEV_CONFIG = process.env.DEVELOPMENT_CONFIG === 'true';

const APIAI_ACCESS_TOKEN = process.env.APIAI_ACCESS_TOKEN;
const APIAI_LANG = process.env.APIAI_LANG;

const INFERMEDICA_APPID = process.env.INFERMEDICA_APPID;
const INFERMEDICA_APPKEY = process.env.INFERMEDICA_APPKEY;

const SPARK_ACCESS_TOKEN = process.env.SPARK_ACCESS_TOKEN;

const MONGODB_URL = process.env.MONGODB_URL;

const GOOGLE_GEOCODING_KEY = process.env.GOOGLE_GEOCODING_KEY;
const BETTER_DOCTOR_KEY = process.env.BETTER_DOCTOR_KEY;

const BASE_URL = process.env.BASE_URL;

const MAX_QUESTIONS = process.env.MAX_QUESTIONS;

let bot;

// console timestamps
require('console-stamp')(console, 'yyyy.mm.dd HH:MM:ss.l');

function startBot() {

    console.log("Starting bot");

    const botConfig = new SparkBotConfig(
        APIAI_ACCESS_TOKEN,
        APIAI_LANG,
        SPARK_ACCESS_TOKEN,
        INFERMEDICA_APPID,
        INFERMEDICA_APPKEY,
        MONGODB_URL,
        GOOGLE_GEOCODING_KEY,
        BETTER_DOCTOR_KEY,
        MAX_QUESTIONS);

    botConfig.devConfig = DEV_CONFIG;

    bot = new SparkBot(botConfig, BASE_URL + '/webhook');

    bot.loadProfile()
        .then((profile) => {
            bot.setProfile(profile);
            bot.setupWebhook();
            bot.loadSpecialties();
        })
        .catch((err) => {
            console.error(err);
        });
}

startBot();

const app = express();

app.use(bodyParser.json());

app.post('/webhook', (req, res) => {
    console.log('POST webhook');

    try {
        if (bot) {
            bot.processMessage(req, res);
        }
    } catch (err) {
        return res.status(400).send('Error while processing ' + err.message);
    }
});

app.listen(REST_PORT, () => {
    console.log('Rest service ready on port ' + REST_PORT);
});

