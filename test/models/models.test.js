const { expect } = require('chai');
const createRecordModel = require('../../libs/models/record');
const createTemplateModel = require('../../libs/models/template');

describe('@kne/fastify-message 模型定义', () => {
  const DataTypes = {
    BIGINT: 'BIGINT',
    INTEGER: 'INTEGER',
    STRING: 'STRING',
    TEXT: 'TEXT',
    JSON: 'JSON',
    JSONB: 'JSONB'
  };

  it('should define record model fields and associations', () => {
    let userModelRequested = false;
    const options = {
      getUserModel: () => {
        userModelRequested = true;
        return 'UserModel';
      }
    };
    const definition = createRecordModel({ DataTypes, options });
    const belongsToCalls = [];
    const record = {
      belongsTo: (...args) => belongsToCalls.push(args)
    };
    const template = 'TemplateModel';

    definition.associate({ record, template });

    expect(definition.model.name.type).to.equal('STRING');
    expect(definition.model.type.defaultValue).to.equal(0);
    expect(definition.model.content.type).to.equal('JSONB');
    expect(userModelRequested).to.equal(true);
    expect(belongsToCalls.length).to.equal(2);
    expect(belongsToCalls[0][0]).to.equal('UserModel');
    expect(belongsToCalls[1][0]).to.equal('TemplateModel');
  });

  it('should define template model fields and associations', () => {
    let userModelRequested = false;
    const options = {
      getUserModel: () => {
        userModelRequested = true;
        return 'UserModel';
      }
    };
    const definition = createTemplateModel({ DataTypes, options });
    const belongsToCalls = [];
    const template = {
      belongsTo: (...args) => belongsToCalls.push(args)
    };

    definition.associate({ template });

    expect(definition.model.code.allowNull).to.equal(false);
    expect(definition.model.type.allowNull).to.equal(false);
    expect(definition.model.level.defaultValue).to.equal(1);
    expect(definition.model.status.defaultValue).to.equal(0);
    expect(userModelRequested).to.equal(true);
    expect(belongsToCalls.length).to.equal(1);
    expect(belongsToCalls[0][0]).to.equal('UserModel');
  });
});
