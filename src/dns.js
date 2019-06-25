import _ from 'lodash';
import AWS from 'aws-sdk';

let EC2, // Populated in handler
  Route53,
  Region;

exports.handler = function (event, context, callback) {
  console.log('Handling event', event);

  let succeed = (v) => { console.info('✅  Execution succeeded', v); callback(null, v); }
  let fail = (exc) => { console.error('🛑  Execution failed:', exc); callback(exc); }

  Region = event.region;
  AWS.config.update({ region: Region });
  EC2 = new AWS.EC2({ apiVersion: '2016-11-15' });
  Route53 = new AWS.Route53({ apiVersion: '2013-04-01' });

  run(event).then(succeed, fail);
}

async function run(event) {
  let instanceIDs = _.flatMap(event.resources, (arn) => {
    let match = arn.match(/^arn:aws:ec2:[\w-]+:\d+:instance\/(i-.+)$/);
    return _.isEmpty(match) ? [] : match[1];
  });
  let instanceDatas = await getInstanceDatas(instanceIDs);
  let resourceRecordSets = await getResourceRecordSets(instanceDatas)
  if (process.env["DRY_RUN"] == "true") {
    console.log('Running in dry-run mode. The following changes would have been applied:')
    console.log(JSON.stringify(resourceRecordSets, null, 2))
    console.log('Running in dry-run mode. No changes have been applied.')
  } else {
    await Promise.all(resourceRecordSets.map(async resourceRecordSet => {
      await Route53.changeResourceRecordSets(resourceRecordSet).promise()
      console.log('Change applied:', JSON.stringify(resourceRecordSet, null, 2))
    }));
    if (resourceRecordSets.length == 0) console.log('No changes applied.')
  }
  return true
}

async function getInstanceDatas(instanceIDs) {
  let ec2Response = await EC2.describeInstances({
    InstanceIds: instanceIDs
  }).promise();

  let instances = _.flatMap(ec2Response.Reservations, (r) => r.Instances);
  return _.filter(_.flatMap(instances, (instance) => {
    let tags = _.fromPairs(_.map(instance.Tags, (tag) => [tag.Key, tag.Value]));
    if (_.has(tags, 'r53-domain-name') && _.has(tags, 'r53-zone-ids')) {
      return {
        ip: instance.PrivateIpAddress,
        domain: `${_.trimEnd(tags["r53-domain-name"], '.')}.`,
        zoneIDs: tags["r53-zone-ids"].split(","),
        state: instance.State.Name
      }
    }
    return {}
  }), e => { return Object.keys(e).length > 0 });
}

async function getResourceRecordSets(instanceDatas) {
  let results = await Promise.all(instanceDatas.map(async instance => {
    return Promise.all(instance.zoneIDs.map(async zoneID => {
      let change;
      let listRsp = await Route53.listResourceRecordSets({
        HostedZoneId: zoneID,
        StartRecordType: 'A',
        StartRecordName: instance.domain,
        MaxItems: '1'
      }).promise();
      let matchedRecord = _.find(listRsp.ResourceRecordSets, (rs) => {
        return rs.Type === 'A' && _.trimEnd(rs.Name, '.') === _.trimEnd(instance.domain, '.')
      });

      if (!_.isNil(matchedRecord) && ['shutting-down', 'terminated', 'stopping', 'stopped'].indexOf(instance.state) > -1) {
        return {
          HostedZoneId: zoneID,
          ChangeBatch: {
            Changes: [
              {
                Action: 'DELETE',
                ResourceRecordSet: matchedRecord,
              }
            ],
            Comment: `Automated update by Lambda function @ ${new Date().toString()}`,
          }
        };
      } else if (!_.isNil(matchedRecord) && ['pending', 'running'].indexOf(instance.state) > -1) {
        return {}
      } else {
        return {
          HostedZoneId: zoneID,
          ChangeBatch: {
            Changes: [
              {
                Action: 'UPSERT',
                ResourceRecordSet: {
                  TTL: 5,
                  Type: 'A',
                  Name: instance.domain,
                  ResourceRecords: [{ Value: instance.ip }]
                }
              }
            ],
            Comment: `Automated update by Lambda function @ ${new Date().toString()}`,
          }
        };
      }
    }));
  }));
  return _.flatten(results).filter(e => { return Object.keys(e).length > 0 })
}