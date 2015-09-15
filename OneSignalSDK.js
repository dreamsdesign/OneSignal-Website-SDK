/**
 * Modified MIT License
 *
 * Copyright 2015 OneSignal
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * 1. The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * 2. All copies of substantial portions of the Software may only be used in connection
 * with services provided by OneSignal.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

// Requires Chrome version 42+
// Web push notifications are supported on Mac OSX, Windows, Linux, and Android.
var _temp_OneSignal = null;

if (typeof OneSignal !== "undefined")
  _temp_OneSignal = OneSignal;

var OneSignal = {
  _VERSION: 10303,
  _HOST_URL: "https://onesignal.com/api/v1/",
  _IS_DEV: false,

  _app_id: null,

  _tagsToSendOnRegister: null,

  _notificationOpened_callback: null,
  _idsAvailable_callback: null,

  _defaultLaunchURL: null,

  _oneSignal_db: null,

  _init_options: null,

  _httpRegistration: false,

  _main_page_port: null,

  _isNotificationEnabledCallback: null,

  _subscriptionSet: true,
  
  _initOneSignalHttp: null,
  
  _sessionIframeAdded: false,
  
  _useHttpMode: null,

  LOGGING: false,

  SERVICE_WORKER_UPDATER_PATH: "OneSignalSDKUpdaterWorker.js",
  SERVICE_WORKER_PATH: "OneSignalSDKWorker.js",
  SERVICE_WORKER_PARAM: {},

  _log: function (message, args) {
    if (OneSignal.LOGGING) {
      if (typeof args !== "undefined")
        console.log(message, args);
      else
        console.log(message);
    }
  },

  _init_oneSignal_db: function (callback) {
    if (OneSignal._oneSignal_db) {
      callback();
      return;
    }

    var request = indexedDB.open("ONE_SIGNAL_SDK_DB", 1);
    request.onsuccess = function (event) {
      OneSignal._oneSignal_db = event.target.result;
      callback();
    };

    request.onupgradeneeded = function (event) {
      var db = event.target.result;

      db.createObjectStore("Ids", {keyPath: "type"});
      db.createObjectStore("NotificationOpened", {keyPath: "url"});
      db.createObjectStore("Options", {keyPath: "key"});
    };
  },

  _get_db_value: function (table, key, callback) {
    OneSignal._init_oneSignal_db(function () {
      OneSignal._oneSignal_db.transaction(table).objectStore(table).get(key).onsuccess = callback;
    });
  },

  _get_all_values: function (table, callback) {
    OneSignal._init_oneSignal_db(function () {
      var jsonResult = {};
      OneSignal._oneSignal_db.transaction(table).objectStore(table).openCursor().onsuccess = function (event) {
        var cursor = event.target.result;
        if (cursor) {
          jsonResult[cursor.key] = cursor.value.value;
          cursor.continue();
        }
        else
          callback(jsonResult);
      };
    });
  },

  _put_db_value: function (table, value) {
    OneSignal._init_oneSignal_db(function () {
      OneSignal._oneSignal_db.transaction([table], "readwrite").objectStore(table).put(value);
    });
  },

  _delete_db_value: function (table, key) {
    OneSignal._init_oneSignal_db(function () {
      OneSignal._oneSignal_db.transaction([table], "readwrite").objectStore(table).delete(key);
    });
  },

  _sendToOneSignalApi: function (url, action, inData, callback, failedCallback) {
    var contents = {
      method: action,
      //mode: 'no-cors', // no-cors is disabled for non-serviceworker.
    };

    if (inData) {
      contents.headers = {"Content-type": "application/json;charset=UTF-8"};
      contents.body = JSON.stringify(inData);
    }

    fetch(OneSignal._HOST_URL + url, contents)
      .then(function status(response) {
        if (response.status >= 200 && response.status < 300)
          return Promise.resolve(response);
        else
          return Promise.reject(new Error(response.statusText));
      })
      .then(function status(response) {
        return response.json();
      })
      .then(function (jsonData) {
        OneSignal._log(jsonData);
        if (callback != null)
          callback(jsonData);
      })
      .catch(function (error) {
        OneSignal._log('Request failed', error);
        if (failedCallback != null)
          failedCallback();
      });
  },

  _getLanguage: function () {
    return navigator.language ? (navigator.language.length > 3 ? navigator.language.substring(0, 2) : navigator.language) : 'en';
  },

  _getPlayerId: function (value, callback) {
    if (value)
      callback(value)
    else {
      OneSignal._get_db_value("Ids", "userId", function (event) {
        if (event.target.result)
          callback(event.target.result.id);
        else
          callback(null);
      });
    }
  },

  _registerWithOneSignal: function (appId, registrationId) {
    OneSignal._get_db_value("Ids", "userId", function (eventUserId) {
    OneSignal._getNotificationTypes(function (notif_types) {
      var requestUrl = 'players';

      var jsonData = {
        app_id: appId,
        device_type: 5,
        language: OneSignal._getLanguage(),
        timezone: new Date().getTimezoneOffset() * -60,
        device_model: navigator.platform + " Chrome",
        device_os: navigator.appVersion.match(/Chrome\/(.*?) /)[1],
        sdk: OneSignal._VERSION
      };
      
      if (eventUserId.target.result) {
        requestUrl = 'players/' + eventUserId.target.result.id + '/on_session';
        jsonData.notification_types = notif_types
      }
      else if (notif_types != 1)
        jsonData.notification_types = notif_types

      if (registrationId) {
        jsonData.identifier = registrationId;
        OneSignal._put_db_value("Ids", {type: "registrationId", id: registrationId});
      }

      OneSignal._sendToOneSignalApi(requestUrl, 'POST', jsonData,
        function registeredCallback(responseJSON) {
          sessionStorage.setItem("ONE_SIGNAL_SESSION", true);

          if (responseJSON.id) {
            OneSignal._put_db_value("Ids", {type: "userId", id: responseJSON.id});

            if (OneSignal._tagsToSendOnRegister) {
              OneSignal.sendTags(OneSignal._tagsToSendOnRegister);
              _tagsToSendOnRegister = null;
            }
          }

          OneSignal._getPlayerId(responseJSON.id, function (userId) {
            if (OneSignal._idsAvailable_callback) {
              OneSignal._idsAvailable_callback({userId: userId, registrationId: registrationId});
              OneSignal._idsAvailable_callback = null;
            }

            if (OneSignal._httpRegistration) {
              OneSignal._log("Sending player Id and registrationId back to host page");
              OneSignal._log(OneSignal._init_options);
              var creator = opener || parent;
              OneSignal._safePostMessage(creator, {idsAvailable: {userId: userId, registrationId: registrationId}}, OneSignal._init_options.origin, null);

              if (opener)
                window.close();
            }
            else
              OneSignal._log("NO opener");
          });
        }
      );
      
    });
    });
  },

  setDefaultNotificationUrl: function (url) {
    OneSignal._put_db_value("Options", {key: "defaultUrl", value: url});
  },

  setDefaultIcon: function (icon) {
    OneSignal._put_db_value("Options", {key: "defaultIcon", value: icon});
  },

  setDefaultTitle: function (title) {
    OneSignal._put_db_value("Options", {key: "defaultTitle", value: title});
  },

  _visibilitychange: function () {
    if (document.visibilityState == "visible") {
      document.removeEventListener("visibilitychange", OneSignal._visibilitychange);
      OneSignal._sessionInit({});
    }
  },

  init: function (options) {
    OneSignal._init_options = options;

    if (!OneSignal.isPushNotificationsSupported()) {
      OneSignal._log("ERROR: Your browser does not support push notifications.");
      return;
    }

    if (document.readyState === "complete")
      OneSignal._internalInit();
    else
      window.addEventListener('load', OneSignal._internalInit);
  },

  _internalInit: function () {
    OneSignal._useHttpMode = OneSignal._isHttpSite() || OneSignal._init_options.subdomainName;

    if (OneSignal._useHttpMode)
      OneSignal._initOneSignalHttp = 'https://' + OneSignal._init_options.subdomainName + '.onesignal.com/sdks/initOneSignalHttp';
    else
      OneSignal._initOneSignalHttp = 'https://onesignal.com/sdks/initOneSignalHttps';
    
    if (OneSignal._IS_DEV)
      OneSignal._initOneSignalHttp = 'https://192.168.1.181:3000/dev_sdks/initOneSignalHttp';
    
    OneSignal._get_db_value("Ids", "appId", function (appIdEvent) {
      OneSignal._get_db_value("Ids", "registrationId", function (regIdEvent) {
        // If AppId changed delete playerId and continue.
        if (appIdEvent.target.result && appIdEvent.target.result.id != OneSignal._init_options.appId) {
          OneSignal._delete_db_value("Ids", "userId");
          sessionStorage.removeItem("ONE_SIGNAL_SESSION");
        }

        // HTTPS - Only register for push notifications once per session or if the user changes notification permission to ask or allow.
        if (sessionStorage.getItem("ONE_SIGNAL_SESSION")
          && !OneSignal._init_options.subdomainName
          && (Notification.permission == "denied"
          || sessionStorage.getItem("ONE_SIGNAL_NOTIFICATION_PERMISSION") == Notification.permission))
          return;

        sessionStorage.setItem("ONE_SIGNAL_NOTIFICATION_PERMISSION", Notification.permission);

        if (OneSignal._init_options.autoRegister == false && !regIdEvent.target.result && OneSignal._init_options.subdomainName == null)
          return;

        if (document.visibilityState != "visible") {
          document.addEventListener("visibilitychange", OneSignal._visibilitychange);
          return;
        }

        OneSignal._sessionInit({});
      });
    });
  },

  registerForPushNotifications: function (options) {
    // WARNING: Do NOT add callbacks that have to fire to get from here to window.open in _sessionInit.
    //          Otherwise the pop-up to ask for push permission on the OneSignal Subdomain will be blocked by Chrome.
    if (!options)
      options = {};
    options.fromRegisterFor = true;
    OneSignal._sessionInit(options);
  },

  // Subdomain only - Only called from iframe or pop-up window.
  _initHttp: function (options) {
    OneSignal._init_options = options;
    
    if (options.continuePressed)
      OneSignal.setSubscription(true);
    
    var isIframe = (parent != null && parent != window);
    var creator = opener || parent;
    
    if (!creator) {
      OneSignal._log("ERROR:_initHttp: No opner or parent found!");
      return;
    }

    // Setting up message channel to receive message from host page.
    var messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = function (event) {
      OneSignal._log("_initHttp.messageChannel.port1.onmessage", event);
      
      if (event.data.initOptions) {
        OneSignal.setDefaultNotificationUrl(event.data.initOptions.defaultUrl);
        OneSignal.setDefaultTitle(event.data.initOptions.defaultTitle);
        if (event.data.initOptions.defaultIcon)
          OneSignal.setDefaultIcon(event.data.initOptions.defaultIcon);

        OneSignal._log("document.URL", event.data.initOptions.parent_url);
        OneSignal._get_db_value("NotificationOpened", event.data.initOptions.parent_url, function (value) {
          OneSignal._log("_initHttp NotificationOpened db", value);
          if (value.target.result) {
            OneSignal._delete_db_value("NotificationOpened", event.data.initOptions.parent_url);
            OneSignal._log("OneSignal._safePostMessage:targetOrigin:", OneSignal._init_options.origin);
            
            OneSignal._safePostMessage(creator, {openedNotification: value.target.result.data}, OneSignal._init_options.origin, null);
          }
        });
      }
      else if (event.data.getNotificationPermission) {
        OneSignal._getSubdomainState(function(curState) {
          OneSignal._safePostMessage(creator, {currentNotificationPermission: curState }, OneSignal._init_options.origin, null);
        });
      }
      else if (event.data.setSubdomainState)
        OneSignal.setSubscription(event.data.setSubdomainState.setSubscription);
    };
    
    OneSignal._getSubdomainState(function(curState) {
      curState["isIframe"] = isIframe;
      OneSignal._safePostMessage(creator, {oneSignalInitPageReady: curState}, OneSignal._init_options.origin, [messageChannel.port2]);
    });

    OneSignal._initSaveState();
    OneSignal._httpRegistration = true;
    if (location.search.indexOf("?session=true") == 0)
      return;
    
    OneSignal._getPlayerId(null, function(player_id) {
      if (!isIframe || player_id) {
        OneSignal._log("Before navigator.serviceWorker.register");
        navigator.serviceWorker.register(OneSignal.SERVICE_WORKER_PATH, OneSignal.SERVICE_WORKER_PARAM).then(OneSignal._enableNotifications, OneSignal._registerError);
        OneSignal._log("After navigator.serviceWorker.register");
      }
    });
  },
  
  _getSubdomainState: function(callback) {
    OneSignal._get_db_value("Ids", "userId", function (userIdEvent) {
      OneSignal._get_db_value("Ids", "registrationId", function (registrationIdEvent) {
        OneSignal._get_db_value("Options", "subscription", function (subscriptionEvent) {
          callback({
            userId: userIdEvent.target.result ? userIdEvent.target.result.id : null,
            registrationId: registrationIdEvent.target.result ? registrationIdEvent.target.result.id : null,
            notifPermssion: Notification.permission,
            subscriptionSet: subscriptionEvent.target.result ? subscriptionEvent.target.result.value : null,
            isPushEnabled:( Notification.permission == "granted" 
                         && userIdEvent.target.result
                         && registrationIdEvent.target.result
                         && ((subscriptionEvent.target.result && subscriptionEvent.target.result.value) || subscriptionEvent.target.result == null))
          });
        });
      });
    });
  },

  _initSaveState: function () {
    OneSignal._app_id = OneSignal._init_options.appId;
    OneSignal._put_db_value("Ids", {type: "appId", id: OneSignal._app_id});
    OneSignal._put_db_value("Options", {key: "pageTitle", value: document.title});
  },

  _isHttpSite: function () {
    return (location.protocol !== 'https:' && location.host.indexOf("localhost") != 0 && location.host.indexOf("127.0.0.1") != 0);
  },

  _sessionInit: function (options) {
    OneSignal._log("_sessionInit", options);
    OneSignal._initSaveState();
    
    var hostPageProtocol = location.origin.match(/^http(s|):\/\/(www\.|)/)[0];

    // If HTTP or using subdomain mode
    if (OneSignal._useHttpMode) {
      if (options.fromRegisterFor) {
        var dualScreenLeft = window.screenLeft != undefined ? window.screenLeft : screen.left;
        var dualScreenTop = window.screenTop != undefined ? window.screenTop : screen.top;

        var thisWidth = window.innerWidth ? window.innerWidth : document.documentElement.clientWidth ? document.documentElement.clientWidth : screen.width;
        var thisHeight = window.innerHeight ? window.innerHeight : document.documentElement.clientHeight ? document.documentElement.clientHeight : screen.height;
        var childWidth = 550;
        var childHeight = 335;

        var left = ((thisWidth / 2) - (childWidth / 2)) + dualScreenLeft;
        var top = ((thisHeight / 2) - (childHeight / 2)) + dualScreenTop;
        var childWindow = window.open(OneSignal._initOneSignalHttp + "?hostPageProtocol=" + hostPageProtocol, "_blank", 'scrollbars=yes, width=' + childWidth + ', height=' + childHeight + ', top=' + top + ', left=' + left);

        if (childWindow)
          childWindow.focus();
      }
      else
        OneSignal._addSessionIframe(hostPageProtocol);
      
      return;
    }

    // If HTTPS - Show modal
    if (options.modalPrompt && options.fromRegisterFor) {
      OneSignal.isPushNotificationsEnabled(function (pushEnabled) {
        var element = document.createElement('div');
        element.setAttribute('id', 'OneSignal-iframe-modal');
        element.innerHTML = '<div id="notif-permission" style="background: rgba(0, 0, 0, 0.7); position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9000; display: block"></div>';
        document.body.appendChild(element);

        var iframeStyle = document.createElement('style');
        iframeStyle.innerHTML = "@media (max-width: 560px) { .OneSignal-permission-iframe { width: 100%; height: 100%;} }"
          + "@media (min-width: 561px) { .OneSignal-permission-iframe { top: 50%; left: 50%; margin-left: -275px; margin-top: -158px;} }";
        document.getElementsByTagName('head')[0].appendChild(iframeStyle);

        var iframeNode = document.createElement("iframe");
        iframeNode.className = "OneSignal-permission-iframe"
        iframeNode.style.cssText = "background: rgba(255, 255, 255, 1); position: fixed;";
        iframeNode.src = OneSignal._initOneSignalHttp
          + '?id=' + OneSignal._app_id
          + '&httpsPrompt=true'
          + '&pushEnabled=' + pushEnabled
          + '&permissionBlocked=' + (typeof Notification === "undefined" || Notification.permission == "denied")
          + '&hostPageProtocol=' + hostPageProtocol;
        iframeNode.setAttribute('frameborder', '0');
        iframeNode.width = "550";
        iframeNode.height = "335";

        document.getElementById("notif-permission").appendChild(iframeNode);
      });
    }
    else if ('serviceWorker' in navigator && navigator.userAgent.toLowerCase().indexOf('chrome') > -1) { // If HTTPS - Show native prompt
      OneSignal._get_db_value("Ids", "registrationId", function (event) {
        if (!event.target.result || !options.fromRegisterFor || Notification.permission != "granted") {
          navigator.serviceWorker.getRegistration().then(function (event) {
            var sw_path = "";

            if (OneSignal._init_options.path)
              sw_path = OneSignal._init_options.path;

            if (typeof event === "undefined") // Nothing registered, very first run
              navigator.serviceWorker.register(sw_path + OneSignal.SERVICE_WORKER_PATH, OneSignal.SERVICE_WORKER_PARAM).then(OneSignal._enableNotifications, OneSignal._registerError);
            else {
              if (event.active) {
                if (event.active.scriptURL.indexOf(sw_path + OneSignal.SERVICE_WORKER_PATH) > -1) {
                  OneSignal._get_db_value("Ids", "WORKER1_ONE_SIGNAL_SW_VERSION", function (version) {
                    if (version.target.result) {
                      if (version.target.result.id != OneSignal._VERSION) {
                        event.unregister().then(function () {
                          navigator.serviceWorker.register(sw_path + OneSignal.SERVICE_WORKER_UPDATER_PATH, OneSignal.SERVICE_WORKER_PARAM).then(OneSignal._enableNotifications, OneSignal._registerError);
                        });
                      }
                      else
                        navigator.serviceWorker.register(sw_path + OneSignal.SERVICE_WORKER_PATH, OneSignal.SERVICE_WORKER_PARAM).then(OneSignal._enableNotifications, OneSignal._registerError);
                    }
                    else
                      navigator.serviceWorker.register(sw_path + OneSignal.SERVICE_WORKER_PATH, OneSignal.SERVICE_WORKER_PARAM).then(OneSignal._enableNotifications, OneSignal._registerError);
                  });
                }
                else if (event.active.scriptURL.indexOf(sw_path + OneSignal.SERVICE_WORKER_UPDATER_PATH) > -1) {
                  OneSignal._get_db_value("Ids", "WORKER2_ONE_SIGNAL_SW_VERSION", function (version) {
                    if (version.target.result) {
                      if (version.target.result.id != OneSignal._VERSION) {
                        event.unregister().then(function () {
                          navigator.serviceWorker.register(sw_path + OneSignal.SERVICE_WORKER_PATH, OneSignal.SERVICE_WORKER_PARAM).then(OneSignal._enableNotifications, OneSignal._registerError);
                        });
                      }
                      else
                        navigator.serviceWorker.register(sw_path + OneSignal.SERVICE_WORKER_UPDATER_PATH, OneSignal.SERVICE_WORKER_PARAM).then(OneSignal._enableNotifications, OneSignal._registerError);
                    }
                    else
                      navigator.serviceWorker.register(sw_path + OneSignal.SERVICE_WORKER_UPDATER_PATH, OneSignal.SERVICE_WORKER_PARAM).then(OneSignal._enableNotifications, OneSignal._registerError);
                  });
                }
              }
              else if (event.installing == null)
                navigator.serviceWorker.register(sw_path + OneSignal.SERVICE_WORKER_PATH, OneSignal.SERVICE_WORKER_PARAM).then(OneSignal._enableNotifications, OneSignal._registerError);
            }
          }).catch(function (error) {
            OneSignal._log("ERROR Getting registration: " + error);
          });
        }
      });
    }
    else
      OneSignal._log('Service workers are not supported in this browser.');
  },
  
  _addSessionIframe: function(hostPageProtocol) {
    
    var node = document.createElement("iframe");
    node.style.display = "none";
    node.src = OneSignal._initOneSignalHttp + "Iframe";
    if (sessionStorage.getItem("ONE_SIGNAL_SESSION"))
      node.src += "?session=true"
                + "&hostPageProtocol=" + hostPageProtocol;
    else
      node.src += "?hostPageProtocol=" + hostPageProtocol
    document.body.appendChild(node);
    
    OneSignal._sessionIframeAdded = true;
  },

  _registerError: function (err) {
    OneSignal._log("navigator.serviceWorker.register:ERROR: " + err);
  },

  _enableNotifications: function (existingServiceWorkerRegistration) { // is ServiceWorkerRegistration type
    OneSignal._log("_enableNotifications: ", existingServiceWorkerRegistration);

    if (!('PushManager' in window)) {
      OneSignal._log("Push messaging is not supported.");
      sessionStorage.setItem("ONE_SIGNAL_SESSION", true);
      return;
    }

    if (!('showNotification' in ServiceWorkerRegistration.prototype)) {
      OneSignal._log("Notifications are not supported.");
      sessionStorage.setItem("ONE_SIGNAL_SESSION", true);
      return;
    }

    if (Notification.permission === 'denied') {
      OneSignal._log("The user has disabled notifications.");
      return;
    }

    navigator.serviceWorker.ready.then(function (serviceWorkerRegistration) {
      OneSignal._log(serviceWorkerRegistration);

      OneSignal._subscribeForPush(serviceWorkerRegistration);
    });
  },

  _subscribeForPush: function (serviceWorkerRegistration) {
    OneSignal._log("navigator.serviceWorker.ready.then");

    serviceWorkerRegistration.pushManager.subscribe({userVisibleOnly: true})
      .then(function (subscription) {
        sessionStorage.setItem("ONE_SIGNAL_NOTIFICATION_PERMISSION", Notification.permission);

        OneSignal._get_db_value("Ids", "appId", function (event) {
          appId = event.target.result.id
          OneSignal._log("serviceWorkerRegistration.pushManager.subscribe()");

          var registrationId = null;
          if (subscription) {
            if (subscription.endpoint && subscription.endpoint.startsWith("https://android.googleapis.com/gcm/send/")) // Chrome 44+
              registrationId = subscription.endpoint.replace("https://android.googleapis.com/gcm/send/", "");
            else // Chrome 43 & older
              registrationId = subscription.subscriptionId;
            OneSignal._log('registration id is:' + registrationId);
          }
          else
            OneSignal._log('Error could not subscribe to GCM!');

          OneSignal._registerWithOneSignal(appId, registrationId);
        });
      })
      .catch(function (err) {
        OneSignal._log('Error during subscribe()');
        OneSignal._log(err);
        if (err.code == 20 && opener && OneSignal._httpRegistration)
          window.close();
      });
  },

  sendTag: function (key, value) {
    jsonKeyValue = {};
    jsonKeyValue[key] = value;
    OneSignal.sendTags(jsonKeyValue);
  },

  sendTags: function (jsonPair) {
    OneSignal._get_db_value("Ids", "userId", function (event) {
      if (event.target.result)
        OneSignal._sendToOneSignalApi("players/" + event.target.result.id, "PUT", {app_id: OneSignal._app_id, tags: jsonPair});
      else {
        if (OneSignal._tagsToSendOnRegister == null)
          OneSignal._tagsToSendOnRegister = jsonPair;
        else {
          var resultObj = {};
          for (var _obj in OneSignal._tagsToSendOnRegister) resultObj[_obj] = OneSignal._tagsToSendOnRegister[_obj];
          for (var _obj in jsonPair) resultObj[_obj] = jsonPair[_obj];
          OneSignal._tagsToSendOnRegister = resultObj;
        }
      }
    });
  },

  deleteTag: function (key) {
    OneSignal.deleteTags([key]);
  },

  deleteTags: function (keyArray) {
    var jsonPair = {};
    var length = keyArray.length;
    for (var i = 0; i < length; i++)
      jsonPair[keyArray[i]] = "";

    OneSignal.sendTags(jsonPair);
  },

  _handleNotificationOpened: function (event) {
    var notificationData = JSON.parse(event.notification.tag);
    event.notification.close();

    OneSignal._get_db_value("Ids", "appId", function (appIdEvent) {
      if (appIdEvent.target.result) {
        OneSignal._get_db_value("Ids", "userId", function (userIdEvent) {
          if (userIdEvent.target.result) {
            OneSignal._sendToOneSignalApi("notifications/" + notificationData.id, "PUT",
              {app_id: appIdEvent.target.result.id, player_id: userIdEvent.target.result.id, opened: true});
          }
        });
      }
    });

    event.waitUntil(
      clients.matchAll({type: "window"})
        .then(function (clientList) {
          var launchURL = registration.scope;
          if (OneSignal._defaultLaunchURL)
            launchURL = OneSignal._defaultLaunchURL;
          if (notificationData.launchURL)
            launchURL = notificationData.launchURL;

          for (var i = 0; i < clientList.length; i++) {
            var client = clientList[i];
            if ('focus' in client && client.url == launchURL) {
              client.focus();

              // targetOrigin not valid here as the service worker owns the page.
              client.postMessage(notificationData);
              return;
            }
          }

          OneSignal._put_db_value("NotificationOpened", {url: launchURL, data: notificationData});
          clients.openWindow(launchURL).catch(function (error) {
            // Should only fall into here if going to an external URL on Chrome older than 43.
            clients.openWindow(registration.scope + "redirector.html?url=" + launchURL);
          });
        })
    );
  },

  _getTitle: function (incomingTitle, callback) {
    if (incomingTitle != null) {
      callback(incomingTitle);
      return;
    }

    OneSignal._get_db_value("Options", "defaultTitle", function (event) {
      if (event.target.result) {
        callback(event.target.result.value);
        return;
      }

      OneSignal._get_db_value("Options", "pageTitle", function (event) {
        if (event.target.result && event.target.result.value != null) {
          callback(event.target.result.value);
          return;
        }

        callback("");
      });
    });
  },

  // Displays notification from content received from OneSignal.
  _handleGCMMessage: function (serviceWorker, event) {
    // TODO: Read data from the GCM payload when Chrome no longer requires the below command line parameter.
    // --enable-push-message-payload
    // The command line param is required even on Chrome 43 nightly build 2015/03/17.
    if (event.data && event.data.text()[0] == "{") {
      OneSignal._log('Received data.text: ', event.data.text());
      OneSignal._log('Received data.json: ', event.data.json());
    }

    event.waitUntil(new Promise(
      function (resolve, reject) {
        OneSignal._getTitle(null, function (title) {
          OneSignal._get_db_value("Options", "defaultIcon", function (eventIcon) {
            OneSignal._getLastNotifications(function (response, appId) {
              var notificationData = {
                id: response.custom.i,
                message: response.alert,
                additionalData: response.custom.a
              };

              if (response.title)
                notificationData.title = response.title;
              else
                notificationData.title = title;

              if (response.custom.u)
                notificationData.launchURL = response.custom.u;

              if (response.icon)
                notificationData.icon = response.icon;
              else if (eventIcon.target.result)
                notificationData.icon = eventIcon.target.result.value;

              // Never nest the following line in a callback from the point of entering from _getLastNotifications
              serviceWorker.registration.showNotification(notificationData.title, {
                body: response.alert,
                icon: notificationData.icon,
                tag: JSON.stringify(notificationData)
              }).then(resolve);

              OneSignal._get_db_value("Options", "defaultUrl", function (eventUrl) {
                if (eventUrl.target.result)
                  OneSignal._defaultLaunchURL = eventUrl.target.result.value;
              });
            }, resolve);
          });
        });
      }
    ));
  },

  _getLastNotifications: function (itemCallback, completeCallback) {
    OneSignal._get_db_value("Ids", "userId", function (event) {
      if (event.target.result) {
        OneSignal._sendToOneSignalApi("players/" + event.target.result.id + "/chromeweb_notification", "GET", null, function (response) {
          for (var i = 0; i < response.length; i++)
            itemCallback(JSON.parse(response[i]));
        }, function () {
          completeCallback();
        });  // Failed callback
      }
      else {
        OneSignal._log("Error: could not get notificationId");
        completeCallback();
      }
    });
  },

  // HTTP & HTTPS - Runs on main page
  _listener_receiveMessage: function receiveMessage(event) {
    OneSignal._log("_listener_receiveMessage: ", event);

    if (OneSignal._init_options == undefined)
      return;

    if (!OneSignal._IS_DEV && event.origin !== "" && event.origin !== "https://onesignal.com" && event.origin !== "https://" + OneSignal._init_options.subdomainName + ".onesignal.com")
     return;

    if (event.data.oneSignalInitPageReady) { // Subdomain Only.
      OneSignal._get_all_values("Options", function (options) {
        OneSignal._log("current options", options);
        if (!options.defaultUrl)
          options.defaultUrl = document.URL;
        if (!options.defaultTitle)
          options.defaultTitle = document.title;

        options.parent_url = document.URL;
        OneSignal._log("Posting message to port[0]", event.ports[0]);
        event.ports[0].postMessage({initOptions: options});
      });
      
      var eventData = event.data.oneSignalInitPageReady;

      if (eventData.isIframe)
        OneSignal._iframePort = event.ports[0];
      
      if (eventData.userId)
        OneSignal._put_db_value("Ids", {type: "userId", id: eventData.userId});
      if (eventData.registrationId)
        OneSignal._put_db_value("Ids", {type: "registrationId", id: eventData.registrationId});
      
      OneSignal._fireNotificationEnabledCallback(eventData.isPushEnabled);
    }
    else if (event.data.currentNotificationPermission) // Subdomain Only
      OneSignal._fireNotificationEnabledCallback(event.data.currentNotificationPermission.isPushEnabled);
    else if (event.data.idsAvailable) { // Subdomain Only - Called when user presses continue and allow on pop-up window.
      sessionStorage.setItem("ONE_SIGNAL_SESSION", true);
      OneSignal._put_db_value("Ids", {type: "userId", id: event.data.idsAvailable.userId});
      OneSignal._put_db_value("Ids", {type: "registrationId", id: event.data.idsAvailable.registrationId});

      if (OneSignal._idsAvailable_callback) {
        OneSignal._idsAvailable_callback({userId: event.data.idsAvailable.userId, registrationId: event.data.idsAvailable.registrationId});
        OneSignal._idsAvailable_callback = null;
      }
    }
    else if (event.data.httpsPromptAccepted) { // HTTPS Only
      OneSignal.registerForPushNotifications();
      OneSignal.setSubscription(true);
      (elem = document.getElementById('OneSignal-iframe-modal')).parentNode.removeChild(elem);
    }
    else if (event.data.httpsPromptCanceled) { // HTTPS Only
      (elem = document.getElementById('OneSignal-iframe-modal')).parentNode.removeChild(elem);
    }
    else if (OneSignal._notificationOpened_callback) // Subdomain and HTTPS
      OneSignal._notificationOpened_callback(event.data);
  },

  addListenerForNotificationOpened: function (callback) {
    OneSignal._notificationOpened_callback = callback;
    if (window) {
      OneSignal._get_db_value("NotificationOpened", document.URL, function (value) {
        if (value.target.result) {
          OneSignal._delete_db_value("NotificationOpened", document.URL);
          OneSignal._notificationOpened_callback(value.target.result.data);
        }
      });
    }
  },
  
  // Subdomain - Fired from message received from iframe.
  _fireNotificationEnabledCallback: function(notifPermssion) {
     if (OneSignal._isNotificationEnabledCallback) {
      OneSignal._isNotificationEnabledCallback(notifPermssion);
      OneSignal._isNotificationEnabledCallback = null;
    }
  },

  getIdsAvailable: function (callback) {
    OneSignal._idsAvailable_callback = callback;

    OneSignal._get_db_value("Ids", "userId", function (userIdEvent) {
      if (userIdEvent.target.result) {
        OneSignal._get_db_value("Ids", "registrationId", function (registrationIdEvent) {
          if (registrationIdEvent.target.result) {
            callback({userId: userIdEvent.target.result.id, registrationId: registrationIdEvent.target.result.id});
            OneSignal._idsAvailable_callback = null;
          }
          else
            callback({userId: userIdEvent.target.result.id, registrationId: null});
        });
      }
    });
  },

  getTags: function (callback) {
    OneSignal._get_db_value("Ids", "userId", function (userIdEvent) {
      if (userIdEvent.target.result) {
        OneSignal._sendToOneSignalApi("players/" + userIdEvent.target.result.id, 'GET', null, function (response) {
          callback(response.tags);
        });
      }
    });
  },

  isPushNotificationsEnabled: function (callback) {
    // If Subdomain
    if (OneSignal._init_options.subdomainName) {
      OneSignal._isNotificationEnabledCallback = callback;
      if (OneSignal._iframePort)
        OneSignal._iframePort.postMessage({getNotificationPermission: true});
      return;
    }
    
    // If HTTPS
    OneSignal._get_db_value("Ids", "registrationId", function (registrationIdEvent) {
      if (registrationIdEvent.target.result) {
        OneSignal._get_db_value("Options", "subscription", function (subscriptionEnabledEvent) {
          if (subscriptionEnabledEvent.target.result && !subscriptionEnabledEvent.target.result.value)
            return callback(false);
            
            callback(Notification.permission == "granted");
        });
      }
      else
        callback(false);
    });
  },

  isPushNotificationsSupported: function () {
    var chromeVersion = navigator.appVersion.match(/Chrome\/(.*?) /);
    
    // Chrome is not found in appVersion.
    if (!chromeVersion)
      return false;
    
    // Microsoft Edge
    if (navigator.appVersion.match(/Edge/))
      return false;
    
    // Android Chrome WebView
    if (navigator.appVersion.match(/ wv/))
      return false;
    
    // Opera
    if (navigator.appVersion.match(/OPR\//))
      return false;

    return parseInt(chromeVersion[1].substring(0, 2)) > 41;
  },

  _getNotificationTypes: function(callback) {
    OneSignal._getSubscription(function(db_subscriptionSet) {
        callback(db_subscriptionSet ? 1 : -2);
    });
  },

  setSubscription: function (enable) {
    if (OneSignal._iframePort)
      OneSignal._iframePort.postMessage({setSubdomainState: {setSubscription: enable}});
    else {
      OneSignal._getSubscription(function(db_subscriptionSet) {
        if (db_subscriptionSet != enable) {
          OneSignal._put_db_value("Options", {key: "subscription", value: enable});
          OneSignal._get_db_value("Ids", "userId", function (event) {
            if (event.target.result)
              OneSignal._sendToOneSignalApi("players/" + event.target.result.id, "PUT", {app_id: OneSignal._app_id, notification_types: enable ? 1 : -2});
          });
        }
      });
    }
  },
  
  _getSubscription: function (callback) {
    OneSignal._get_db_value("Options", "subscription", function (subscriptionEvent) {
      callback(!(subscriptionEvent.target.result && subscriptionEvent.target.result.value == false));
    });
  },
  
  _safePostMessage: function(creator, data, targetOrigin, receiver) {
    var tOrigin = targetOrigin.toLowerCase();
    
    // If we are trying to target a http site allow the https version. (w/ or w/o 'wwww.' too)
    if (tOrigin.startsWith("http://")) {
        var queryDict = {};
        location.search.substr(1).split("&").forEach(function(item) {queryDict[item.split("=")[0]] = item.split("=")[1]});
        var validPreURLRegex = /^http(s|):\/\/(www\.|)/;
        tOrigin = tOrigin.replace(validPreURLRegex, queryDict["hostPageProtocol"]);
    }
    
    creator.postMessage(data, tOrigin, receiver);
  },

  _process_pushes: function (array) {
    for (var i = 0; i < array.length; i++)
      OneSignal.push(array[i]);
  },

  push: function (item) {
    if (typeof(item) == "function")
      item();
    else {
      var functionName = item.shift();
      OneSignal[functionName].apply(null, item);
    }
  }
};


if (OneSignal._IS_DEV) {
  OneSignal.LOGGING = true;
  OneSignal._HOST_URL = "https://192.168.1.181:3000/api/v1/";
}

// If imported on your page.
if (typeof  window !== "undefined")
  window.addEventListener("message", OneSignal._listener_receiveMessage, false);
else { // if imported from the service worker.
  importScripts('https://cdn.onesignal.com/sdks/serviceworker-cache-polyfill.js');

  self.addEventListener('push', function (event) {
    OneSignal._handleGCMMessage(self, event);
  });
  self.addEventListener('notificationclick', function (event) {
    OneSignal._handleNotificationOpened(event);
  });

  var isSWonSubdomain = location.href.match(/https\:\/\/.*\.onesignal.com\/sdks\//) != null;
  
  if (OneSignal._IS_DEV)
     isSWonSubdomain = true;

  self.addEventListener('install', function (event) {
    OneSignal._log("OneSignal Installed service worker: " + OneSignal._VERSION);
    if (self.location.pathname.indexOf("OneSignalSDKWorker.js") > -1)
      OneSignal._put_db_value("Ids", {type: "WORKER1_ONE_SIGNAL_SW_VERSION", id: OneSignal._VERSION});
    else
      OneSignal._put_db_value("Ids", {type: "WORKER2_ONE_SIGNAL_SW_VERSION", id: OneSignal._VERSION});

    if (isSWonSubdomain) {
      event.waitUntil(
        caches.open("OneSignal_" + OneSignal._VERSION).then(function (cache) {
          return cache.addAll([
            '/sdks/initOneSignalHttpIframe',
            '/sdks/initOneSignalHttpIframe?session=*',
            '/sdks/manifest_json']);
        })
      );
    }
  });

  if (isSWonSubdomain) {
    self.addEventListener('fetch', function (event) {
      event.respondWith(
        caches.match(event.request)
          .then(function (response) {
            // Cache hit - return response
            if (response)
              return response;

            return fetch(event.request);
          }
        )
      );
    });
  }
}

if (_temp_OneSignal)
  OneSignal._process_pushes(_temp_OneSignal);