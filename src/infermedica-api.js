'use strict';

const request = require('request');


module.exports = class InfermedicaApi {
  constructor (appId, appKey, apiModel = 'infermedica-en', apiUrl = 'https://api.infermedica.com/v2/') {
    this.appId = appId;
    this.appKey = appKey;

    this.apiUrl = apiUrl;
    this.apiModel = apiModel;
  }

  setAppId (appId) {
    this.appId = appId;
  }

  setAppKey (appKey) {
    this.appKey = appKey;
  }

  _req (method, url, data) {
    return new Promise((resolve, reject) => {

        var options = { method: method,
            url: this.apiUrl + url,
            headers:
                {   'App-Id': this.appId,
                    'App-Key': this.appKey,
                    'Model' : this.apiModel,
                    'Content-Type': 'application/json'
                },
            body: data};

        request(options, function (error, response, body) {
            if (error) {
                console.error('Error while sending Infermedica request:', error);

                reject(error);
            } else if (response.statusCode !== 200) {
                console.log('Infermedica error:', response.statusCode, body);
                
                reject();
            } else {
                let result = JSON.parse(body);
                resolve(result);
            }

        });

    });
  }

  _get (url) {
    return this._req('GET', url);
  }

  _post (url, data) {
    return this._req('POST', url, data);
  }

  getSymptoms () {
    return this._get('symptoms');
  }

  getRiskFactors () {
    return this._get('risk_factors');
  }

  getCondition(id){
    return this._get('conditions' + '/' + id);
  }

  parse (text) {
    return this._post('parse', JSON.stringify({'text': text}));
  }

  diagnosis (data) {
    return this._post('diagnosis', JSON.stringify(data));
  }

  explain (data) {
    return this._post('explain', JSON.stringify(data));
  }

};
