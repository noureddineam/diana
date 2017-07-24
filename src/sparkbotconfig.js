'use strict';

module.exports = class SparkBotConfig {

    get maxQuestions() {
        return this._maxQuestions;
    }

    set maxQuestions(value) {
        this._maxQuestions = value;
    }
    get googleGeocodingKey() {
        return this._googleGeocodingKey;
    }

    set googleGeocodingKey(value) {
        this._googleGeocodingKey = value;
    }
    get betterDoctorKey() {
        return this._betterDoctorKey;
    }

    set betterDoctorKey(value) {
        this._betterDoctorKey = value;
    }

    get mongodbUrl() {
        return this._mongodbUrl;
    }

    set mongodbUrl(value) {
        this._mongodbUrl = value;
    }

    get apiaiAccessToken() {
        return this._apiaiAccessToken;
    }

    set apiaiAccessToken(value) {
        this._apiaiAccessToken = value;
    }

    get apiaiLang() {
        return this._apiaiLang;
    }

    set apiaiLang(value) {
        this._apiaiLang = value;
    }

    get sparkToken() {
        return this._sparkToken;
    }

    set sparkToken(value) {
        this._sparkToken = value;
    }

    get devConfig() {
        return this._devConfig;
    }

    set devConfig(value) {
        this._devConfig = value;
    }

    get infermedicaAppId() {
        return this._infermedicaAppId;
    }

    set infermedicaAppId(value) {
        this._infermedicaAppId = value;
    }

    get infermedicaAppKey() {
        return this._infermedicaAppKey;
    }

    set infermedicaAppKey(value) {
        this._infermedicaAppKey = value;
    }

    constructor(apiaiAccessToken, apiaiLang, sparkToken, infermedicaAppId, infermedicaAppKey, mongodbUrl, googleGeocodingKey, betterDoctorKey, maxQuestions) {
        this._apiaiAccessToken = apiaiAccessToken;
        this._apiaiLang = apiaiLang;
        this._sparkToken = sparkToken;
        this._infermedicaAppId = infermedicaAppId;
        this._infermedicaAppKey = infermedicaAppKey;
        this._mongodbUrl = mongodbUrl;
        this._googleGeocodingKey = googleGeocodingKey;
        this._betterDoctorKey = betterDoctorKey;
        this._maxQuestions = maxQuestions;
    }

    toPlainDoc() {
        return {
            apiaiAccessToken: this._apiaiAccessToken,
            apiaiLang: this._apiaiLang,
            sparkToken: this._sparkToken,
            infermedicaAppId: this._infermedicaAppId,
            infermedicaAppKey: this._infermedicaAppKey,
            mongodbUrl: this._mongodbUrl,
            googleGeocodingKey: this._googleGeocodingKey,
            betterDoctorKey: this._betterDoctorKey,
            maxQuestions: this._maxQuestions
        }
    }

    static fromPlainDoc(doc) {
        return new SparkBotConfig(
            doc.apiaiAccessToken,
            doc.apiaiLang,
            doc.sparkToken,
            doc.infermedicaAppId,
            doc.infermedicaAppKey,
            doc.mongodbUrl,
            doc.googleGeocodingKey,
            doc.betterDoctorKey,
            doc.maxQuestions
        );
    }
};