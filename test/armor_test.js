suite('taskcluster.(un)armorCredentials', function() {
  var taskcluster     = require('../');
  var assert          = require('assert');

  test("armorCredentials produces something that looks right", function() {
    assert.equal(
      taskcluster.armorCredentials({clientId: "clid"}), [
        '-----BEGIN TASKCLUSTER CREDENTIALS-----',
        'Version: 1',
        'ClientId: clid',
        'Caution: Treat this data as a password!',
        '',
        'eyJjbGllbnRJZCI6ImNsaWQifQ==',
        '-----END TASKCLUSTER CREDENTIALS-----'].join('\n'));
  });

  var credentials = {
    clientId: 'tester',
    accessToken: 'no-secret',
    certificate: JSON.stringify({
      version: 1,
      scopes: [
        "assume:mozilla-group:scm_level_1",
        "assume:mozilla-group:scm_level_3",
        "assume:mozilla-group:scm_level_2",
        "assume:mozilla-group:team_relops",
        "assume:mozilla-group:team_moco",
        "assume:mozilla-group:team_taskcluster",
        "assume:mozillians-user:dustin"
      ],
      start: 1455572024782,
      expiry: 1455832124782,
      seed: "ae5WqpaAShWdYe8yJvquaQXfO1Ht6FRAK2QoeEAWKQSw",
      signature: "9fvwRBv+KGWNhfE60uJDuV8vvDw2nkoHphnuCQsiDNA="
    }),
  };

  test("round trip", function() {
    var armored = taskcluster.armorCredentials(credentials);
    var unarmored = taskcluster.unarmorCredentials(armored);
    assert.deepEqual(unarmored, credentials);
  });

  test("round trip, DOS newlines", function() {
    var armored = taskcluster.armorCredentials(credentials);
    armored.replace("\n", "\r\n");
    var unarmored = taskcluster.unarmorCredentials(armored);
    assert.deepEqual(unarmored, credentials);
  });

  test("round trip, garbage before and after", function() {
    var armored = taskcluster.armorCredentials(credentials);
    armored = "Here are your credentials.\n\nGood luck!\n" + armored;
    armored = armored + "\n-- Your Friendly TC Admin\n";
    var unarmored = taskcluster.unarmorCredentials(armored);
    assert.deepEqual(unarmored, credentials);
  });

  test("round trip, indented", function() {
    var armored = taskcluster.armorCredentials(credentials);
    armored = armored.split("\n");
    armored = armored.map(function(line) { return "    " + line; });
    armored = armored.join("\n");
    var unarmored = taskcluster.unarmorCredentials(armored);
    assert.deepEqual(unarmored, credentials);
  });

  test("unarmorCredentials, no header", function() {
    assert.throws(function() {
      taskcluster.unarmorCredentials("-----END TASKCLUSTER CREDENTIALS-----");
    });
  });

  test("unarmorCredentials, no footer", function() {
    assert.throws(function() {
      taskcluster.unarmorCredentials("-----BEGIN TASKCLUSTER CREDENTIALS-----");
    });
  });

  test("unarmorCredentials, no header", function() {
    assert.throws(function() {
      taskcluster.unarmorCredentials([
        "-----BEGIN TASKCLUSTER CREDENTIALS-----",
        "eyJjbGllbnRJZCI6ImNsaWQifQ==",
        "-----END TASKCLUSTER CREDENTIALS-----",
      ].join("\n"));
    });
  });

  test("unarmorCredentials, bad header", function() {
    assert.throws(function() {
      taskcluster.unarmorCredentials([
        "-----BEGIN TASKCLUSTER CREDENTIALS-----",
        "Cookie: 3",
        "",
        "eyJjbGllbnRJZCI6ImNsaWQifQ==",
        "-----END TASKCLUSTER CREDENTIALS-----",
      ].join("\n"));
    });
  });

  test("unarmorCredentials, bad version", function() {
    assert.throws(function() {
      taskcluster.unarmorCredentials([
        "-----BEGIN TASKCLUSTER CREDENTIALS-----",
        "Version: 3",
        "",
        "eyJjbGllbnRJZCI6ImNsaWQifQ==",
        "-----END TASKCLUSTER CREDENTIALS-----",
      ].join("\n"));
    });
  });

  test("unarmorCredentials, bad base64", function() {
    assert.throws(function() {
      taskcluster.unarmorCredentials([
        "-----BEGIN TASKCLUSTER CREDENTIALS-----",
        "Version: 1",
        "",
        "eyJjbGll!!!!!CI6ImNsaWQifQ==",
        "-----END TASKCLUSTER CREDENTIALS-----",
      ].join("\n"));
    });
  });

  test("unarmorCredentials, bad JSON", function() {
    assert.throws(function() {
      taskcluster.unarmorCredentials([
        "-----BEGIN TASKCLUSTER CREDENTIALS-----",
        "Version: 1",
        "",
        new Buffer("{{").toString('base64'),
        "-----END TASKCLUSTER CREDENTIALS-----",
      ].join("\n"));
    });
  });
});
