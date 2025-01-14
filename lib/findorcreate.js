"use strict";

// I know about the deprecation of defer as outlined here:
// https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules/Promise.jsm/Deferred#backwards_forwards_compatible
// but the proper way as done in https://github.com/Automattic/mongoose/blob/67c465aac5c864c3004d11d49934605037c8f520/lib/query.js#L2226
// would involve more changes to the code. As a first attempt, less changes is better I think. The proper way would
// yield the same results, so it's safe to refactor later.
function Deferred() {
  /* A method to resolve the associated Promise with the value passed.
   * If the promise is already settled it does nothing.
   *
   * @param {anything} value : This value is used to resolve the promise
   * If the value is a Promise then the associated promise assumes the state
   * of Promise passed as value.
   */
  this.resolve = null;

  /* A method to reject the associated Promise with the value passed.
   * If the promise is already settled it does nothing.
   *
   * @param {anything} reason: The reason for the rejection of the Promise.
   * Generally its an Error object. If however a Promise is passed, then the Promise
   * itself will be the reason for rejection no matter the state of the Promise.
   */
  this.reject = null;

  /* A newly created Promise object.
   * Initially in pending state.
   */
  this.promise = new Promise(
    function (resolve, reject) {
      this.resolve = resolve;
      this.reject = reject;
    }.bind(this)
  );
  Object.freeze(this);
}

const defaultOptions = {
  /*
    If a field in the existing doc is an array, we can overwrite it (false) or
    merely append to it (true)
  */
  appendToArray: false,

  /*
    You can pass parameters to save() using this object
  */
  saveOptions: {},

  /*
    This param allows you to only save the additionalFields if the document is
    new, effectively not doing any update.
    This is useful if you need to check if a document exists and assign it a new
    value for a different field only if it is not already there.
  */
  saveIfFound: false,
};

function isObject(testMe) {
  if (testMe === null || typeof testMe === "undefined") return false;
  return Object.getPrototypeOf(testMe) === Object.getPrototypeOf({});
}

function sanitizeMongoKeys(query) {
  if (typeof query !== "object" || query instanceof Date || query === null) return query;

  const cleanQuery = {};

  for (const key in query) {
    if (key[0] === "$") continue;

    const cleanParam = sanitizeMongoKeys(query[key]);

    if (isObject(cleanParam) && Object.keys(cleanParam).length < 1) continue;

    cleanQuery[key] = query[key];
  }

  return cleanQuery;
}

module.exports = function (schema, modelOptions) {
  schema.statics.findOrCreate = function findOrCreate(
    query,
    additionalFields,
    contextOptions,
    callback
  ) {
    // In the case of findOrCreate(query, callback)
    if (typeof additionalFields === "function") {
      callback = additionalFields;
      additionalFields = undefined;
    }

    // In the case of findOrCreate(query, additionalFields, callback)
    if (typeof contextOptions === "function") {
      callback = contextOptions;
      contextOptions = undefined;
    }

    const options = Object.assign({}, defaultOptions, modelOptions, contextOptions);

    var deferred;
    if (!callback) {
      deferred = new Deferred();
      callback = function (err, result, wasUpdated, isNew) {
        if (err) {
          deferred.reject(err);
        } else {
          if (options.status) {
            result = {
              result: result,
              wasUpdated: wasUpdated,
              isNew: isNew,
            };
          }
          deferred.resolve(result);
        }
      };
    }

    this.findOne(query)
      .then((result) => {
        if (result && !additionalFields) return callback(null, result, false, false);

        const creating = result ? false : true;
        const doc = creating ? new this(sanitizeMongoKeys(query)) : result;

        if (!creating && !options.saveIfFound) return callback(null, doc, false, creating);

        if (additionalFields) {
          for (const field in additionalFields) {
            if (Array.isArray(doc[field]) && options.appendToArray) {
              doc.set(field, doc[field].concat(additionalFields[field]));
              continue;
            }

            doc.set(field, additionalFields[field]);
          }
        }

        if (!doc.isModified() && !creating) return callback(null, doc, false, creating);

        doc.save(options.saveOptions).then((err) => callback(null, doc, true, creating));
      })
      .catch((err) => {
        return callback(err, null, false, false);
      });

    return deferred ? deferred.promise : undefined;
  };
};
