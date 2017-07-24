'use strict';

const apiai = require('apiai');
const uuid = require('uuid');
const request = require('request');
const async = require('async');
const MongoClient = require('mongodb').MongoClient;
const stringSimilarity = require('string-similarity');

const DIAGNOSTICS_IN_PROGRESS_CONTEXT = "diagnosticsinprogress";
const SEARCH_DOCTOR_SPECIALTY_CONTEXT = "usersearchdoctorspecialty";
const SEARCH_DOCTOR_ADDRESS_CONTEXT = "usersearchdoctoraddress";

// actions
const DIAGNOSTICS_START_ACTION = "diagnostics.start";
const UPDATE_USERINFO_ACTION = "update.user.info";
const INPUT_UNKNOWN_ACTION = "input.unknown";
const SEARCH_DOCTOR_AFTER_DIAGNOSIS_ACTION = "searchdoctorafterdiagnosis";
const WIKIPEDIA_SEARCH = "wikipedia.search";

// events
const ASK_SYMPTOMS_EVENT = "askforsymptoms";
const ASK_MORE_SYMPTOMS_EVENT = "askformoresymptoms";
const NOT_ENOUGH_SYMPTOMS_EVENT = "diagnosticnotenoughsymptoms";
const ASK_USERINFO_EVENT = "askuserinfo";
const DIAGNOSTICS_START_EVENT = "diagnosticssart";
const WELCOME_EVENT = "welcome";
const FINAL_CONDITION_EVENT = "finalcondition";
const INFERMEDICA_FALLBACK_EVENT = "infermedicafallback";
const CANT_FIND_SPECIALTY_EVENT = "cantfindspecialty";
const CANT_FIND_ADDRESS_EVENT = "cantfindaddress";
const CANT_FIND_DOCTORS_EVENT = "cantfinddoctors";

const SEARCH_DOCTOR_ASK_ADDRESS = "searchdoctoraskaddress";

const InfermedicaApi = require('./infermedica-api');

module.exports = class SparkBot {

    get apiaiService() {
        return this._apiaiService;
    }

    set apiaiService(value) {
        this._apiaiService = value;
    }

    get botConfig() {
        return this._botConfig;
    }

    set botConfig(value) {
        this._botConfig = value;
    }

    get sessionIds() {
        return this._sessionIds;
    }

    set sessionIds(value) {
        this._sessionIds = value;
    }

    constructor(botConfig, webhookUrl) {
        this._botConfig = botConfig;
        let apiaiOptions = {
            language: botConfig.apiaiLang,
            requestSource: "spark"
        };

        this._apiaiService = apiai(botConfig.apiaiAccessToken, apiaiOptions);
        this._sessionIds = new Map();
        this._specialties = new Map();
        this._infermedicaApi =  new InfermedicaApi(botConfig.infermedicaAppId, botConfig.infermedicaAppKey);

        this._webhookUrl = webhookUrl;
        console.log('Starting bot on ' + this._webhookUrl);
    }

    /**
     * Deletes all previous webhooks then creates one
     */
    setupWebhook() {
        request.get("https://api.ciscospark.com/v1/webhooks",
            {
                auth: {
                    bearer: this._botConfig.sparkToken
                }
            }, (err, resp) => {
                if (err) {
                    console.error("Error while setup webhook", err);
                    return;
                }

                if (resp.statusCode > 200) {
                    let message = resp.statusMessage;
                    if (resp.body && resp.body.message) {
                        message += ", " + resp.body.message;
                    }
                    console.error("Error while setup webhook", message);
                    return;
                }

                let items = JSON.parse(resp.body).items;

                if (SparkBot.isDefined(items) && items.length > 0){
                    for (let i = 0; i < items.length; i++){
                        this.deleteWebhook(items[i].id);
                    }
                }

                this.createWebhook();
            });
    }


    /**
     * Creates the spark webhook for all events
     */
    createWebhook(){
        request.post("https://api.ciscospark.com/v1/webhooks",
            {
                auth: {
                    bearer: this._botConfig.sparkToken
                },
                json: {
                    event: "all",
                    name: "DianaWebhook",
                    resource: "all",
                    targetUrl: this._webhookUrl
                }
            }, (err, resp) => {
                if (err) {
                    console.error("Error while setup webhook", err);
                    return;
                }

                if (resp.statusCode > 200) {
                    let message = resp.statusMessage;
                    if (resp.body && resp.body.message) {
                        message += ", " + resp.body.message;
                    }
                    console.error("Error while setup webhook", message);
                    return;
                }

                console.log("Webhook result", resp.body);
                this._botConfig.webhookId = resp.body.id;
            });
    }


    geocodeAddress(address){
        return new Promise((resolve, reject) => {
            request.get(
                {
                    url: "https://maps.googleapis.com/maps/api/geocode/json",
                    qs: {
                        address: address,
                        key: this._botConfig.googleGeocodingKey
                    }
                }, (err, resp) => {
                    if (err) {
                        console.error("Error while geocoding address", err);
                        reject();
                    }

                    if (resp.statusCode > 200) {
                        let message = resp.statusMessage;
                        if (resp.body && resp.body.message) {
                            message += ", " + resp.body.message;
                        }
                        console.error("Error while geocoding address", message);
                        reject();
                    }

                    let results = JSON.parse(resp.body).results;

                    if (SparkBot.isDefined(results) && results.length > 0){
                        resolve(results[0].geometry.location);
                    } else {
                        reject();
                    }
                });
        });
    }


    getdoctorsbyLocationAndSpecialty(maplocation, specialty){
        return new Promise((resolve, reject) => {
            let range = 100; // miles

            request.get(
                {
                    url: "https://api.betterdoctor.com/2016-03-01/doctors",
                    qs: {
                        skip: 0,
                        limit: 5,
                        specialty_uid: specialty,
                        fields: "profile(first_name,last_name,title,bio,image_url),practices(name,phones,within_search_area,website,visit_address)",
                        location: maplocation.lat+","+maplocation.lng+","+range,
                        user_key: this._botConfig.betterDoctorKey
                    }
                }, (err, resp) => {
                    if (err) {
                        console.error("Error getting doctors", err);
                        reject();
                    }

                    if (resp.statusCode > 200) {
                        let message = resp.statusMessage;
                        if (resp.body && resp.body.message) {
                            message += ", " + resp.body.message;
                        }
                        console.error("Error getting doctors", message);
                        reject();
                    }

                    let results = JSON.parse(resp.body).data;

                    if (SparkBot.isDefined(results) && results.length > 0){
                        resolve(results);
                    } else {
                        reject();
                    }
                });
        });
    }

    loadSpecialties(){
        request.get(
            {
                url: "https://api.betterdoctor.com/2016-03-01/specialties",
                qs: {
                    fields: "uid,name",
                    user_key: this._botConfig.betterDoctorKey
                }
            }, (err, resp) => {
                if (err) {
                    console.error("Error getting specialties", err);
                }

                if (resp.statusCode > 200) {
                    let message = resp.statusMessage;
                    if (resp.body && resp.body.message) {
                        message += ", " + resp.body.message;
                    }
                    console.error("Error getting specialties", message);
                }

                let results = JSON.parse(resp.body).data;

                if (SparkBot.isDefined(results) && results.length > 0){
                    for (let i=0; i<results.length; i++){
                        this._specialties.set(results[i].name, results[i].uid);
                    }
                }
            });
    }


    /**
     * Deletes a spark webhook by id
     * @param id the id of the spark webhook
     */
    deleteWebhook(id) {
        request.del("https://api.ciscospark.com/v1/webhooks/" + id,
            {
                auth: {
                    bearer: this._botConfig.sparkToken
                }
            },
            (err, resp) => {
                if (err) {
                    console.error("Error while setup webhook", err);
                } else if (resp.statusCode > 204) {
                    let message = resp.statusMessage;
                    if (resp.body && resp.body.message) {
                        message += ", " + resp.body.message;
                    }
                    console.error("Error while setup webhook", message);
                }
            });
    }

    /**
     * Loads the bot profile
     * @returns {Promise}
     */
    loadProfile() {
        return new Promise((resolve, reject) => {
            request.get("https://api.ciscospark.com/v1/people/me",
                {
                    auth: {
                        bearer: this._botConfig.sparkToken
                    }
                }, (err, resp, body) => {
                    if (err) {
                        console.error('Error while reply:', err);
                        reject(err);
                    } else if (resp.statusCode !== 200) {
                        console.log('loadProfile error:', resp.statusCode, body);
                        if (resp.statusCode === 401) {
                            reject(new Error('Spark Access Token is invalid'));
                        } else {
                            let errorMessage = `Spark error code: ${resp.statusCode}`;
                            if (body.message) {
                                errorMessage += `, message: ${body.message}`;
                            }
                            reject(new Error(errorMessage));
                        }
                    } else {

                        if (this._botConfig.devConfig) {
                            console.log("profile", body);
                        }

                        let result = JSON.parse(body);
                        resolve(result);
                    }
                });
        });
    }

    /**
     * Sets up the profile for this sparkbot class
     * @param profile
     */
    setProfile(profile) {
        if (profile.displayName) {
            this._botName = profile.displayName.replace("(bot)", "").trim();

            if (this._botName.includes(" ")) {
                this._shortName = this._botName.substr(0, this._botName.indexOf(" "));
            } else {
                this._shortName = "";
            }

            console.log("BotName:", this._botName);
            console.log("ShortName:", this._shortName);
        }

        if (profile.emails) {
            if (Array.isArray(profile.emails)) {
                this._emails = profile.emails;
            } else if (String.isString(profile.emails)) {
                this._emails = [profile.emails];
            }
        }

        this._botId = profile.id;
    }

    /**
     * Checks if the message is coming from bot
     * @param updateObject
     * @return {boolean} true if message received from bot
     */
    isBotMessage(updateObject) {
        if (updateObject.data.personEmail) {
            if (updateObject.data.personEmail.endsWith("@sparkbot.io")) {
                return true;
            }

            if (this._emails.indexOf(updateObject.data.personEmail) > -1) {
                return true;
            }
        }

        if (updateObject.data.personId === this._botId) {
            return true;
        }

        return false;
    }


    /**
     * Process messages from Spark
     * @param req
     * @param res
     */
    processMessage(req, res) {
        let updateObject = req.body;

        this.loadSession(updateObject.data).then(() => {
            if (updateObject.resource === "messages" &&
                updateObject.event === "created" &&
                updateObject.data &&
                updateObject.data.id) {

                if (this.isBotMessage(updateObject)) { // Message from bot. Skipping.
                    SparkBot.createResponse(res, 200, 'Message from bot. Ignoring');
                    return;
                }

                this.loadMessage(updateObject.data.id)
                    .then((msg)=> {
                        let messageText = msg.text;
                        let chatId = msg.roomId;

                        if (this._botConfig.devConfig) {
                            console.log("session object: ", JSON.stringify(this._sessionIds.get(chatId)));
                        }

                        if (messageText && chatId) {
                            if (this._botConfig.devConfig) {
                                console.log(chatId, messageText);
                            }

                            messageText = this.removeBotName(messageText);

                            if (this.isDiagnosticsInProgress(chatId)) { // if the diagnostic is in progress
                                this.processMessageForDiagnostic(chatId, messageText, updateObject, res);
                            } else if (this.isSearchDoctorSpecialty(chatId)){
                                
                                let specialtyUid = this.getSpecialtyUid(messageText);
                                if(SparkBot.isDefined(specialtyUid)){
                                    let params = {
                                        specialty: specialtyUid
                                    };

                                    this.sendApiAiEventRequest(SEARCH_DOCTOR_ASK_ADDRESS, updateObject, res, this._sessionIds.get(chatId).contexts, params);
                                } else {
                                    this.sendApiAiEventRequest(CANT_FIND_SPECIALTY_EVENT, updateObject, res, this._sessionIds.get(chatId).contexts);
                                }
                                
                            } else {
                                this.sendApiAiTextRequest(messageText, updateObject, res, this._sessionIds.get(chatId).contexts); // send the query to API.AI for small talk
                            }

                        }
                    })
                    .catch((err) => {
                        console.error("Error while loading message:", err);
                    });
            } else if ((updateObject.resource === "memberships" ||
                updateObject.resource === "rooms") &&
                updateObject.event === "created") {

                let params = {
                    nickname: this._sessionIds.get(updateObject.data.roomId).nickname
                };

                this.sendApiAiEventRequest(WELCOME_EVENT, updateObject, res, this._sessionIds.get(updateObject.data.roomId).contexts, params); // send welcome message
            }

        });

    }

    /**
     * Removes the bot name from the message
     * @param messageText the original message
     * @returns the message without the bot name
     */
    removeBotName(messageText){
        let result = messageText;
        if (this._botName) {
            result = result.replace(this._botName, '');
        }

        if (this._shortName) {
            result = result.replace(this._shortName, '');
        }
        return result;
    }


    /**
     * Processes the message while the diagnostic is in progress
     * @param chatId
     * @param messageText
     * @param updateObject
     * @param res
     */
    processMessageForDiagnostic(chatId, messageText, updateObject, res){
        if (SparkBot.isDefined(this._sessionIds.get(chatId).pendingQuestion)){ // and there is a pending question

            if (this._botConfig.devConfig) {
                console.log("choices: ", JSON.stringify(this._sessionIds.get(chatId).pendingQuestion.items[0].choices));
            }

            this.sendApiAiTextRequest(messageText, updateObject, res, this._sessionIds.get(chatId).contexts);

        } else { // else parse the text message to look for symptoms
            this._infermedicaApi.parse(messageText).then((parseResult) =>{
                if (SparkBot.isDefined(parseResult.mentions) && parseResult.mentions.length > 0){
                    
                    // push the evidence
                    for (let i = 0; i < parseResult.mentions.length; i++){
                        let evidence = {
                            id: parseResult.mentions[i].id,
                            choice_id: parseResult.mentions[i].choice_id
                        };

                        this._sessionIds.get(chatId).evidence.push(evidence);
                    }

                    // ask for more symptoms
                    if (this._sessionIds.get(chatId).asksymptomsCount === 0){

                        this.sendApiAiEventRequest(ASK_MORE_SYMPTOMS_EVENT, updateObject,res, this._sessionIds.get(chatId).contexts);

                        this._sessionIds.get(chatId).asksymptomsCount++;
                    } else {
                        
                        // begin the diagnosis
                        this.requestDiagnosis(chatId, updateObject, res);
                    }

                } else if (this._sessionIds.get(chatId).asksymptomsCount === 0) {
                    let params = {
                        nickname: this._sessionIds.get(chatId).nickname
                    };
                    
                    this._sessionIds.get(chatId).asksymptomsCount++;
                    
                    // we didn't get any symptoms, so we ask again
                    this.sendApiAiEventRequest(ASK_SYMPTOMS_EVENT, updateObject,res, this._sessionIds.get(chatId).contexts, params);
                } else if (this._sessionIds.get(chatId).evidence.length > 0){
                    
                    // if we already have some evidence, we start the diagnosis
                    this.requestDiagnosis(chatId, updateObject, res);
                } else {
                    
                    // we clear the context to stop the diagnosis
                    this.clearSession(chatId);

                    this.sendApiAiEventRequest(NOT_ENOUGH_SYMPTOMS_EVENT, updateObject,res, this._sessionIds.get(chatId).contexts);
                }

                if (this._botConfig.devConfig) {
                    console.log("Here's the parsed text", parseResult);
                }
            }).catch((err) => {
                this.reply(chatId, "Sorry, the diagnosis service is not available right now. Please try again later");
                SparkBot.createResponse(res, 200, 'Error while call to infermedicaApi.diagnosis');
                console.error("Error while parsing text:", err);
            });
        }
    }

    clearSession(chatId){
        this._sessionIds.get(chatId).questionsCount = 0;
        this._sessionIds.get(chatId).asksymptomsCount = 0;
        this._sessionIds.get(chatId).evidence = [];
        this._sessionIds.get(chatId).entities = [];
        this._sessionIds.get(chatId).contexts = [{ name: DIAGNOSTICS_IN_PROGRESS_CONTEXT, lifespan: 0 }];
        delete this._sessionIds.get(chatId).pendingQuestion;
    }

    requestDiagnosis(chatId, updateObject, res){
        let diagnosisData = {
            sex: this._sessionIds.get(chatId).sex,
            age: this._sessionIds.get(chatId).age,
            evidence: this._sessionIds.get(chatId).evidence,
            extras: {ignore_groups:true}
        };

        this._infermedicaApi.diagnosis(diagnosisData).then((diagnosisResult) =>{
            let conditions = diagnosisResult.conditions;
            let question = diagnosisResult.question;

            for (let i = 0; i < conditions.length; i++){
                if (conditions[i].probability > 0.9){
                    this.getFinalCondition(chatId, updateObject, conditions[i].id, conditions[i].probability, res);
                    return;
                }
            }

            if (this._sessionIds.get(chatId).questionsCount > this._botConfig.maxQuestions){
                this.getFinalCondition(chatId, updateObject, conditions[0].id, conditions[0].probability, res);
                return;
            }

            if (SparkBot.isDefined(question)){
                this._sessionIds.get(chatId).pendingQuestion = question;
                this._sessionIds.get(chatId).questionsCount++;

                this.reply(chatId, question.text).then((answer) => {
                    if (this._botConfig.devConfig) {
                        console.log('Reply answer:', answer);
                    }
                })
                .catch((err) => {
                    console.error(err);
                });
                SparkBot.createResponse(res, 200, 'Reply sent');
            }


        }).catch((err) => {
            console.error("Error while parsing text:", err);
            this.reply(chatId, "Sorry, the diagnosis service is not available right now. Please try again later");
            SparkBot.createResponse(res, 200, 'Error while call to infermedicaApi.diagnosis');

        });
    }

    getFinalCondition(chatId, updateObject, conditionId, probability, res){
        this._infermedicaApi.getCondition(conditionId).then((conditionResult) =>{

            this._sessionIds.get(chatId).oldEvidence = this._sessionIds.get(chatId).evidence; // back up the evidence
            this._sessionIds.get(chatId).oldCondition = conditionResult; // back up the condition

            this.clearSession(chatId);

            MongoClient.connect(this._botConfig.mongodbUrl, (err, db) => {
                
                if (err){
                    return;
                }

                let collection = db.collection('sessions');

                collection.insertOne({ _id: chatId, sessionObj: this._sessionIds.get(chatId) }, () => {
                    db.close();
                });

            });

            let parameters = {
                probability: Math.trunc(probability * 100),
                condition: conditionResult.name,
                recommendation: conditionResult.extras.hint
            };
            
            this.getWikipediaImage(conditionResult.name).then((imagelink) => {
                parameters.image = imagelink;
                
                return this.getWikipediaDescription(conditionResult.name);
            }).then((result)=>{
                
                parameters.description = result.description;
                parameters.condition = "["+conditionResult.name+"]("+result.link+")";
                
                this.sendApiAiEventRequest(FINAL_CONDITION_EVENT, updateObject, res, this._sessionIds.get(chatId).contexts, parameters);
            }).catch((err)=> {
                console.error("Error getting wikipedia image/description/link:", err);
                
                this.sendApiAiEventRequest(FINAL_CONDITION_EVENT, updateObject, res, this._sessionIds.get(chatId).contexts, parameters);
            });
            
            // let text = "I can say with a "+ probability*100 + "% probability, that you suffer from "+conditionResult.name+". "+conditionResult.extras.hint;
            //this.reply(chatId, text);
            //this.createResponse(res, 200, 'Reply sent');

        }).catch((err) => {
            console.error("Error while parsing text:", err);
            this.reply(chatId, "Sorry, the diagnosis service is not available right now. Please try again later");
            SparkBot.createResponse(res, 200, 'Error while call to infermedicaApi.getCondition');
        });
    }
    
    
    getWikipediaDescription(search){
        return new Promise((resolve, reject) => {
            request.get(
            {
                url: "https://en.wikipedia.org/w/api.php",
                qs: {
                    action: "opensearch",
                    limit: 1,
                    namespace: 0,
                    format: "json",
                    search: search
                }
            }, (err, resp) => {
                if (err) {
                    reject(err);
                }

                if (resp.statusCode > 200) {
                    let message = resp.statusMessage;
                    if (resp.body && resp.body.message) {
                        message += ", " + resp.body.message;
                    }
                    reject(message);
                }

                let results = JSON.parse(resp.body);

                if (SparkBot.isDefined(results[2][0]) && SparkBot.isDefined(results[3][0])){
                    resolve({
                        description: results[2][0],
                        link: results[3][0]
                    });
                } else {
                    reject("No result found.");
                }
            });
        });
    }
    
    getWikipediaImage(search){
        return new Promise((resolve, reject) => {
            request.get(
            {
                url: "https://en.wikipedia.org/w/api.php",
                qs: {
                    action: "query",
                    prop: "pageimages",
                    format: "json",
                    pithumbsize: 500,
                    titles: search
                }
            }, (err, resp) => {
                if (err) {
                    reject(err);
                }

                if (resp.statusCode > 200) {
                    let message = resp.statusMessage;
                    if (resp.body && resp.body.message) {
                        message += ", " + resp.body.message;
                    }
                    reject(message);
                }

                let pages = JSON.parse(resp.body).query.pages;
                let imagelink;
                
                for (var page in pages) {
                    if (pages[page].thumbnail){
                        imagelink = pages[page].thumbnail.source;
                        break;
                    }
                }
                
                if (SparkBot.isDefined(imagelink)){
                    resolve(imagelink);
                } else {
                    reject("No image found");
                }
            });
        });
    }
    

    loadSession(data){
        return new Promise((resolve) => {
            if (!this._sessionIds.has(data.roomId)) {
                MongoClient.connect(this._botConfig.mongodbUrl, (err, db) => {

                    if (err !== null) {
                        this.loadNewSession(data.personId).then((sessionObj) => {
                            this._sessionIds.set(data.roomId, sessionObj);
                            db.close();
                            resolve();
                        });
                    } else {
                        let collection = db.collection('sessions');

                        collection.find({ _id : data.roomId }).toArray((err, session) => {
                            if (!SparkBot.isDefined(err) && SparkBot.isDefined(session) && session.length !== 0){

                                this._sessionIds.set(data.roomId, session[0].sessionObj);
                                db.close();
                                resolve();
                            } else {
                                this.loadNewSession(data.personId).then((sessionObj) => {
                                    this._sessionIds.set(data.roomId, sessionObj);
                                    db.close();
                                    resolve();
                                });
                            }
                        });
                    }
                });
            } else {
                resolve();
            }
        });
    }

    loadNewSession(personId){
        return new Promise((resolve) => {
            this.getPersonNickname(personId).then((nickname) =>{
                let sessionObj = {
                    age: null,
                    sex: null,
                    nickname: nickname,
                    sessionId: uuid.v4(),   // session id
                    questionsCount: 0,      // questions asked so far for the current diagnosis
                    asksymptomsCount: 0,    // how many times we asked for symptoms
                    evidence: [],           // evidence we have so far for the current diagnosis
                    entities: [],           // entities used for every question
                    contexts: [],           // api.ai contexts
                    oldEvidence: [],        // old evidence
                    oldCondition: []        // old condition
                };

                resolve(sessionObj);
            }).catch(() => {
                let sessionObj = {
                    age: null,
                    sex: null,
                    nickname: null,
                    sessionId: uuid.v4(),   // session id
                    questionsCount: 0,      // questions asked so far for the current diagnosis
                    asksymptomsCount: 0,    // how many times we asked for symptoms
                    evidence: [],           // evidence we have so far for the current diagnosis
                    entities: [],           // entities used for every question
                    contexts: [],           // api.ai contexts
                    oldEvidence: [],        // old evidence
                    oldCondition: []        // old condition
                };

                resolve(sessionObj);
            });
        });
    }

    getPersonNickname(personId){
        return new Promise((resolve, reject) => {
            request.get("https://api.ciscospark.com/v1/people/" + personId,
                {
                    auth: {
                        bearer: this._botConfig.sparkToken
                    }
                }, (err, resp, body) => {
                    if (err) {
                        console.error('Error while reply:', err);
                        reject(err);
                    } else if (resp.statusCode !== 200) {
                        console.log('getPersonNickname error:', resp.statusCode, body);
                        if (resp.statusCode === 401) {
                            reject(new Error('Spark Access Token is invalid'));
                        } else {
                            let errorMessage = `Spark error code: ${resp.statusCode}`;
                            if (body.message) {
                                errorMessage += `, message: ${body.message}`;
                            }
                            reject(new Error(errorMessage));
                        }
                    } else {
                        let result = JSON.parse(body);

                        if (this._botConfig.devConfig) {
                            console.log("Person nickname: ", result.nickName);
                        }

                        resolve(result.nickName);
                    }
                });
        });
    }

    sendApiAiEventRequest(eventId, updateObject, res, contexts, parameters){
        let chatId = updateObject.data.roomId;

        let apiaiRequest = this._apiaiService.eventRequest(
            {
                name: eventId,
                data: parameters || {}
            }
            ,
            {
                sessionId: this._sessionIds.get(chatId).sessionId,
                originalRequest: {
                    data: updateObject,
                    source: "spark"
                },
                contexts: contexts || []
            });

        apiaiRequest.on('response', (response) => {
            if (SparkBot.isDefined(response.result)) {
                let responseText = response.result.fulfillment.speech;
                let responseMessages = response.result.fulfillment.messages;
                let action = response.result.action;
                let parameters = response.result.parameters;

                this.updateContext(chatId, response);

                if (SparkBot.isDefined(action) && this.processAction(chatId, responseText, responseMessages, action, parameters, updateObject, res)){
                    return;
                }

                this.sendApiAiReply(chatId, responseText, responseMessages, res);
            } else {
                if (this._botConfig.devConfig) {
                    console.log('Received empty result');
                }
                SparkBot.createResponse(res, 200, 'Received empty result');
            }
        });

        apiaiRequest.on('error', (error) => {
            console.error('Error while call to api.ai', error);
            SparkBot.createResponse(res, 200, 'Error while call to api.ai');
        });
        apiaiRequest.end();
    }

    updateContext(chatId, response){
        this._sessionIds.get(chatId).contexts = response.result.contexts;
    }

    isDiagnosticsInProgress(chatId){
        let contexts = this._sessionIds.get(chatId).contexts;

        if (!SparkBot.isDefined(contexts)){
            return false;
        }

        for (let i = 0; i < contexts.length; i++){
            if (contexts[i].name === DIAGNOSTICS_IN_PROGRESS_CONTEXT){
                return true;
            }
        }
        return false;
    }
    
    isSearchDoctorSpecialty(chatId){
        let contexts = this._sessionIds.get(chatId).contexts;

        if (!SparkBot.isDefined(contexts)){
            return false;
        }

        for (let i = 0; i < contexts.length; i++){
            if (contexts[i].name === SEARCH_DOCTOR_SPECIALTY_CONTEXT){
                return true;
            }
        }
        return false;
    }

    isSearchDoctorAddress(chatId){
        let contexts = this._sessionIds.get(chatId).contexts;

        if (!SparkBot.isDefined(contexts)){
            return false;
        }

        for (let i = 0; i < contexts.length; i++){
            if (contexts[i].name === SEARCH_DOCTOR_ADDRESS_CONTEXT){
                return true;
            }
        }
        return false;
    }

    sendApiAiTextRequest(messageText, updateObject, res, contexts, entities){

        let chatId = updateObject.data.roomId;

        let apiaiRequest = this._apiaiService.textRequest(messageText,
            {
                sessionId: this._sessionIds.get(chatId).sessionId,
                originalRequest: {
                    data: updateObject,
                    source: "spark"
                },
                entities: entities || [],
                contexts: contexts || []
            });

        apiaiRequest.on('response', (response) => {
            if (SparkBot.isDefined(response.result)) {
                let responseText = response.result.fulfillment.speech;
                let responseMessages = response.result.fulfillment.messages;
                let action = response.result.action;
                let parameters = response.result.parameters;

                this.updateContext(chatId, response);

                if (this.processSearchDoctor(chatId, updateObject, parameters, res)){
                    return;
                }

                if (this.processInfermedicaAnswer(chatId, action, updateObject, res)){
                    return;
                }

                if (SparkBot.isDefined(action) && this.processAction(chatId, responseText, responseMessages, action, parameters, updateObject, res, messageText)){
                    return;
                }

                this.sendApiAiReply(chatId, responseText, responseMessages, res);
            } else {
                if (this._botConfig.devConfig) {
                    console.log('Received empty result');
                }
                SparkBot.createResponse(res, 200, 'Received empty result');
            }
        });

        apiaiRequest.on('error', (error) => {
            console.error('Error while call to api.ai', error);
            SparkBot.createResponse(res, 200, 'Error while call to api.ai');
        });
        apiaiRequest.end();
    }

    sendApiAiReply(chatId, responseText, responseMessages, res){
        if (SparkBot.isDefined(responseMessages) && responseMessages.length > 0) {
            this.replyWithRichContent(chatId, responseMessages)
                .then(() => {
                    if (this._botConfig.devConfig) {
                        console.log('Reply sent');
                    }
                })
                .catch((err) => {
                    console.error(err);
                });
            SparkBot.createResponse(res, 200, 'Reply sent');

        } else if (SparkBot.isDefined(responseText)) {
            if (this._botConfig.devConfig) {
                console.log('Response as text message');
            }
            this.reply(chatId, responseText)
                .then((answer) => {
                    if (this._botConfig.devConfig) {
                        console.log('Reply answer:', answer);
                    }
                })
                .catch((err) => {
                    console.error(err);
                });
            SparkBot.createResponse(res, 200, 'Reply sent');

        } else {
            if (this._botConfig.devConfig) {
                console.log('Received empty speech');
            }
            SparkBot.createResponse(res, 200, 'Received empty speech');
        }
    }

    processAction(chatId, responseText, responseMessages, action, parameters, updateObject, res, messageText){
        if (action === DIAGNOSTICS_START_ACTION){
            if (SparkBot.isDefined(this._sessionIds.get(chatId).age) && SparkBot.isDefined(this._sessionIds.get(chatId).sex)){
                
                let params = {
                    nickname: this._sessionIds.get(chatId).nickname
                };
                // we ask for the symptoms
                this.sendApiAiEventRequest(ASK_SYMPTOMS_EVENT, updateObject, res, this._sessionIds.get(chatId).contexts, params);
            } else {

                // we ask for age and gender
                this.sendApiAiEventRequest(ASK_USERINFO_EVENT, updateObject, res, this._sessionIds.get(chatId).contexts);
            }
            return true;
        } else if (action === UPDATE_USERINFO_ACTION){
            if (SparkBot.isDefined(parameters.age) && SparkBot.isDefined(parameters.sex)){
                this._sessionIds.get(chatId).age = parameters.age.amount;
                this._sessionIds.get(chatId).sex = parameters.sex;

                let params = {
                    nickname: this._sessionIds.get(chatId).nickname
                };

                // we ask for the symptoms
                this.sendApiAiEventRequest(ASK_SYMPTOMS_EVENT, updateObject, res, this._sessionIds.get(chatId).contexts, params);
            } else {

                // we ask for age and gender one more time
                this.sendApiAiEventRequest(ASK_USERINFO_EVENT, updateObject, res, this._sessionIds.get(chatId).contexts);
            }

            return true;
        } else if (action === SEARCH_DOCTOR_AFTER_DIAGNOSIS_ACTION){

            let params = {
                specialty: this.getSpecialtyUid(this._sessionIds.get(chatId).oldCondition.categories[0])
            };
        
            this.sendApiAiEventRequest(SEARCH_DOCTOR_ASK_ADDRESS, updateObject, res, this._sessionIds.get(chatId).contexts, params);
            
            return true;
        
        } else if (action === WIKIPEDIA_SEARCH){
        
            this.getWikipediaDescription(parameters.q).then((result) => {
               
                let msg = {};
                
                msg.markdown = result.description + " [More ...]("+result.link+")";
                
                this.replyWithData(chatId, msg).then(() => {
                    console.log("wikipedia search result sent");
                }).catch((err) => {
                    console.error("Error while sending wikipedia search results", err);
                });
                
                SparkBot.createResponse(res, 200, 'Reply sent');
            }).catch((err) => {
                console.error("Error while searching on wikipedia", err);

                this.reply(chatId, "Sorry, I can't find anything on Wikipedia.").then(() => {
                    console.log("No wikipedia result");
                }).catch((err2) => {
                    console.error("Error while sending no wikipedia results", err2);
                });
                SparkBot.createResponse(res, 200, 'Reply sent');

            });
        
            return true;
        
        } else if (!this.isDiagnosticsInProgress(chatId) && action === INPUT_UNKNOWN_ACTION && SparkBot.isDefined(messageText)){

            // if diagnostic not in progress, and user says something unintelligible, we try to parse it to look for symptoms
            this._infermedicaApi.parse(messageText).then((parseResult) =>{
                if (SparkBot.isDefined(parseResult.mentions) && parseResult.mentions.length > 0){

                    // if the message contains symptoms, we ask if the user wants a diagnosis
                    this.sendApiAiEventRequest(DIAGNOSTICS_START_EVENT, updateObject, res, this._sessionIds.get(chatId).contexts);
                } else {

                    // else, we fallback on the default reply from API.AI
                    this.sendApiAiReply(chatId, responseText, responseMessages, res);
                }

                if (this._botConfig.devConfig) {
                    console.log("Here's the parsed text", parseResult);
                }
            }).catch((err) => {
                console.error("Error while parsing text:", err);
                this.reply(chatId, "Sorry, the diagnosis service is not available right now. Please try again later");
                SparkBot.createResponse(res, 200, 'Error while call to infermedicaApi.diagnosis');
            });
            return true;
        }
        return false;
    }

    processSearchDoctor(chatId, updateObject, parameters, res) {
        if (this.isSearchDoctorAddress(chatId)){
            let address = parameters.address || parameters.city;
            let specialtyUid = parameters.specialty;

            if (SparkBot.isDefined(address)){

                this._sessionIds.get(chatId).contexts = [{ name: SEARCH_DOCTOR_ADDRESS_CONTEXT, lifespan: 0 }];

                this.geocodeAddress(address).then( (maplocation) => {

                    this.getdoctorsbyLocationAndSpecialty(maplocation, specialtyUid).then( (results) => {

                        let sparkMessages = [];
                        for (let i = 0; i < results.length; i++) {

                            let practices = "**Practices:**\n";
                            let withinsearcharea = false;
                            // let map = "https://maps.googleapis.com/maps/api/staticmap?center="+maplocation.lat+","+maplocation.lng+"&size=640x640&scale=2&maptype=roadmap&key="+this._botConfig.googleGeocodingKey;

                            for (let j=0; j < results[i].practices.length; j++){
                                if (results[i].practices[j].within_search_area){
                                    if (SparkBot.isDefined(results[i].practices[j].website)){
                                        practices += "- ["+ results[i].practices[j].name +"]("+ results[i].practices[j].website +")\n\n";
                                    } else {
                                        practices += "- "+ results[i].practices[j].name +"\n\n";
                                    }

                                    for (let k=0; k< results[i].practices[j].phones.length; k++){
                                        if (results[i].practices[j].phones[k].type === "landline"){
                                            practices += "\t**Phone:** "+results[i].practices[j].phones[k].number +"\n\n";
                                        }
                                    }

                                    practices += "\t**Address:** ["+results[i].practices[j].visit_address.street+", "+
                                        results[i].practices[j].visit_address.city+", "+results[i].practices[j].visit_address.state_long+
                                        "](https://www.google.com/maps/search/"+results[i].practices[j].visit_address.lat+","+results[i].practices[j].visit_address.lon+")\n";

                                    // map += "&markers=color:blue|label:"+results[i].practices[j].name +"|"+results[i].practices[j].lat+","+results[i].practices[j].lon;
                                    withinsearcharea = true;
                                }
                            }

                            if (withinsearcharea){
                                let msg = {};

                                msg.markdown = "**Dr. " + results[i].profile.first_name + " " + results[i].profile.last_name +", " + results[i].profile.title + "**\n\n";
                                msg.markdown += results[i].profile.bio + "\n\n";

                                msg.files = [ results[i].profile.image_url ];

                                msg.markdown += practices;

                                // let msgmap = { files: [ encodeURI(map) ] };

                                sparkMessages.push(msg);
                                // sparkMessages.push(msgmap);
                            }
                        }

                        async.eachSeries(sparkMessages, (msg, callback) => {
                                this.replyWithData(chatId, msg)
                                    .then(() => setTimeout(()=>callback(), 300))
                                    .catch(callback);
                            },
                            (err)=> {
                                if (err) {
                                    console.error(err);
                                }
                            });

                        SparkBot.createResponse(res, 200, 'Reply sent');
                    }).catch(() => {
                        this.sendApiAiEventRequest(CANT_FIND_DOCTORS_EVENT, updateObject, res, this._sessionIds.get(chatId).contexts);
                    });
                });

            } else {
                this.sendApiAiEventRequest(CANT_FIND_ADDRESS_EVENT, updateObject, res, this._sessionIds.get(chatId).contexts);
            }

            return true;
        }
    }

    processInfermedicaAnswer(chatId, action, updateObject, res){
        if (this.isDiagnosticsInProgress(chatId) && SparkBot.isDefined(this._sessionIds.get(chatId).pendingQuestion)){

            if (action === "cancel"){

                this.clearSession(chatId);

                return false;
            }

            let choices = this._sessionIds.get(chatId).pendingQuestion.items[0].choices;

            for (let j = 0; j < choices.length; j++){
                if (choices[j].id === action){

                    let evidence = {
                        id: this._sessionIds.get(chatId).pendingQuestion.items[0].id,
                        choice_id: choices[j].id
                    };

                    if (this._botConfig.devConfig) {
                        console.log("new evidence: ", evidence);
                    }

                    this._sessionIds.get(chatId).evidence.push(evidence);

                    delete this._sessionIds.get(chatId).pendingQuestion;

                    this.requestDiagnosis(chatId, updateObject, res);

                    return true;
                }
            }

            // we can't understand the answer, fallback
            this.sendApiAiEventRequest(INFERMEDICA_FALLBACK_EVENT, updateObject, res, this._sessionIds.get(chatId).contexts);

            return true;
        }
        return false;
    }

    getSpecialtyUid(specialty){
        let specialtyKeys = Array.from(this._specialties.keys());
        let bestmatch = stringSimilarity.findBestMatch(specialty, specialtyKeys);

        if (this._botConfig.devConfig) {
            console.log("user said: ", specialty);
            console.log("specialty found: ", bestmatch.bestMatch);
        }

        return bestmatch.bestMatch.rating > 0.3? this._specialties.get(bestmatch.bestMatch.target): null;
    }

    reply(roomId, text, markdown) {

        let msg = {
            roomId: roomId
        };

        if (text) {
            msg.text = text;
        }

        if (markdown) {
            msg.markdown = markdown;
        }

        return new Promise((resolve, reject) => {
            request.post("https://api.ciscospark.com/v1/messages",
                {
                    auth: {
                        bearer: this._botConfig.sparkToken
                    },
                    forever: true,
                    json: msg
                }, (err, resp, body) => {
                    if (err) {
                        console.error('Error while reply:', err);
                        reject('Error while reply: ' + err.message);
                    } else if (resp.statusCode !== 200) {
                        console.log('Error while reply:', resp.statusCode, body);
                        reject('Error while reply: ' + body);
                    } else {
                        resolve(body);
                    }
                });
        });
    }

    replyWithRichContent(roomId, messages){
        let sparkMessages = [];

        for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
            let message = messages[messageIndex];

            if (message.type === 0){ // Text response message object

                // we have to get value from fulfillment.speech, because of here is raw speech
                if (message.speech) {
                    sparkMessages.push({text: message.speech});
                }

            } else if (message.type === 4) { // Custom payload message object

                if (message.payload && message.payload.spark) {

                    // we take a random message from the list
                    let randomIndex = SparkBot.getRandomInt(0, message.payload.spark.length);
                    let msg = message.payload.spark[randomIndex].message;
                    let files = msg.files || [];

                    if (SparkBot.isDefined(msg.image) && msg.image.length > 0){
                        files.push(msg.image);
                        msg.files = files;
                    }

                    sparkMessages.push(msg);
                }

            }

        }

        return new Promise((resolve, reject) => {
            async.eachSeries(sparkMessages, (msg, callback) => {
                    this.replyWithData(roomId, msg)
                        .then(() => setTimeout(()=>callback(), 300))
                        .catch(callback);
                },
                (err)=> {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
        });
    }

    static getRandomInt(min, max) {
        let vmin = Math.ceil(min);
        let vmax = Math.floor(max);
        return Math.floor(Math.random() * (vmax - vmin)) + vmin;
    }

    replyWithData(roomId, messageData) {

        let msg = messageData;
        msg.roomId = roomId;

        return new Promise((resolve, reject) => {
            request.post("https://api.ciscospark.com/v1/messages",
                {
                    auth: {
                        bearer: this._botConfig.sparkToken
                    },
                    forever: true,
                    json: msg
                }, (err, resp, body) => {
                    if (err) {
                        reject('Error while reply: ' + err.message);
                    } else if (resp.statusCode !== 200) {
                        reject('Error while reply: ' + body);
                    } else {
                        resolve(body);
                    }
                });
        });
    }

    loadMessage(messageId) {
        return new Promise((resolve, reject) => {
            request.get("https://api.ciscospark.com/v1/messages/" + messageId,
                {
                    auth: {
                        bearer: this._botConfig.sparkToken
                    }
                }, (err, resp, body) => {
                    if (err) {
                        console.error('Error while reply:', err);
                        reject(err);
                    } else if (resp.statusCode !== 200) {
                        console.error('LoadMessage error:', resp.statusCode, body);
                        reject('LoadMessage error: ' + body);
                    } else {
                        let result = JSON.parse(body);
                        resolve(result);
                    }
                });
        });
    }

    static createResponse(resp, code, message) {
        return resp.status(code).json({
            status: {
                code: code,
                message: message
            }
        });
    }

    static isDefined(obj) {
        if (typeof obj === 'undefined') {
            return false;
        }

        if (!obj) {
            return false;
        }

        return obj !== null;
    }

};