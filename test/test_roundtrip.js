'use strict';

const chai   = require('chai');
const { parseEds, serializeEds, ObjectType, AccessType, DataType } = require('..');
const expect = chai.expect;

/** Build a representative EdsModel covering all relevant object types. */
function buildTestModel() {
    return {
        fileInfo: {
            fileName:         'test.eds',
            fileVersion:      '1',
            fileRevision:     '1',
            edsVersion:       '4.0',
            description:      '',
            creationTime:     '10:00AM',
            creationDate:     '01-01-2024',
            createdBy:        'Test',
            modificationTime: '10:00AM',
            modificationDate: '01-01-2024',
            modifiedBy:       'Test',
        },
        deviceInfo: {
            vendorName:               'Test Vendor',
            vendorNumber:             '0x00000001',
            productName:              'Test Device',
            productNumber:            '0x00000002',
            revisionNumber:           '0x00000000',
            orderCode:                '',
            baudRate10:               false,
            baudRate20:               false,
            baudRate50:               false,
            baudRate125:              false,
            baudRate250:              true,
            baudRate500:              true,
            baudRate800:              false,
            baudRate1000:             false,
            simpleBootUpMaster:       false,
            simpleBootUpSlave:        true,
            granularity:              0,
            dynamicChannelsSupported: 0,
            groupMessaging:           false,
            nrOfRXPDO:                0,
            nrOfTXPDO:                0,
            lssSupported:             false,
        },
        dummyUsage: {},
        comments: ['Test comment'],
        objects: {
            0x1000: {
                parameterName: 'Device type',
                objectType:    ObjectType.VAR,
                dataType:      DataType.UNSIGNED32,
                accessType:    AccessType.READ_ONLY,
                defaultValue:  '0x00000000',
                pdoMapping:    false,
            },
            0x1001: {
                parameterName: 'Error register',
                objectType:    ObjectType.VAR,
                dataType:      DataType.UNSIGNED8,
                accessType:    AccessType.READ_ONLY,
                pdoMapping:    false,
            },
            0x2000: {
                parameterName: 'Read-only UINT32',
                objectType:    ObjectType.VAR,
                dataType:      DataType.UNSIGNED32,
                accessType:    AccessType.READ_ONLY,
                defaultValue:  '0xFF',
                pdoMapping:    false,
            },
            0x2001: {
                parameterName: 'Read-write INT32',
                objectType:    ObjectType.VAR,
                dataType:      DataType.INTEGER32,
                accessType:    AccessType.READ_WRITE,
                defaultValue:  '-1',
                pdoMapping:    false,
            },
            0x2002: {
                parameterName: 'Float value',
                objectType:    ObjectType.VAR,
                dataType:      DataType.REAL32,
                accessType:    AccessType.READ_WRITE,
                defaultValue:  '0',
                pdoMapping:    false,
            },
            0x2010: {
                parameterName: 'Test array',
                objectType:    ObjectType.ARRAY,
                subObjects: {
                    0: { parameterName: 'Max sub-index', objectType: ObjectType.VAR, dataType: DataType.UNSIGNED8,  accessType: AccessType.READ_ONLY,  pdoMapping: false },
                    1: { parameterName: 'Element 1',    objectType: ObjectType.VAR, dataType: DataType.UNSIGNED16, accessType: AccessType.READ_WRITE, defaultValue: '100', pdoMapping: false },
                    2: { parameterName: 'Element 2',    objectType: ObjectType.VAR, dataType: DataType.UNSIGNED16, accessType: AccessType.READ_WRITE, defaultValue: '200', pdoMapping: false },
                    3: { parameterName: 'Element 3',    objectType: ObjectType.VAR, dataType: DataType.UNSIGNED16, accessType: AccessType.READ_WRITE, defaultValue: '300', pdoMapping: false },
                },
            },
            0x2020: {
                parameterName: 'Test record',
                objectType:    ObjectType.RECORD,
                subObjects: {
                    0: { parameterName: 'Max sub-index', objectType: ObjectType.VAR, dataType: DataType.UNSIGNED8,  accessType: AccessType.READ_ONLY,  pdoMapping: false },
                    1: { parameterName: 'Field A',       objectType: ObjectType.VAR, dataType: DataType.INTEGER32,  accessType: AccessType.READ_ONLY,  pdoMapping: false },
                    2: { parameterName: 'Field B',       objectType: ObjectType.VAR, dataType: DataType.REAL32,    accessType: AccessType.READ_WRITE, defaultValue: '0', pdoMapping: false },
                    3: { parameterName: 'Field C',       objectType: ObjectType.VAR, dataType: DataType.UNSIGNED8,  accessType: AccessType.READ_WRITE, pdoMapping: false },
                },
            },
        },
    };
}

describe('canopen-eds', function () {
    describe('parseEds', function () {
        let reparsed;

        before(function () {
            reparsed = parseEds(serializeEds(buildTestModel()));
        });

        it('should return fileInfo.fileName', function () {
            expect(reparsed.fileInfo.fileName).to.equal('test.eds');
        });

        it('should return deviceInfo.vendorName', function () {
            expect(reparsed.deviceInfo.vendorName).to.equal('Test Vendor');
        });

        it('should return deviceInfo.vendorNumber as a string', function () {
            expect(reparsed.deviceInfo.vendorNumber).to.be.a('string');
            expect(reparsed.deviceInfo.vendorNumber.toLowerCase()).to.include('1');
        });

        it('should parse baud rate booleans', function () {
            expect(reparsed.deviceInfo.baudRate250).to.equal(true);
            expect(reparsed.deviceInfo.baudRate500).to.equal(true);
            expect(reparsed.deviceInfo.baudRate10).to.equal(false);
        });

        it('should parse VAR entries', function () {
            const obj = reparsed.objects[0x2000];
            expect(obj).to.exist;
            expect(obj.parameterName).to.equal('Read-only UINT32');
            expect(obj.objectType).to.equal(ObjectType.VAR);
            expect(obj.dataType).to.equal(DataType.UNSIGNED32);
            expect(obj.accessType).to.equal(AccessType.READ_ONLY);
        });

        it('should preserve defaultValue', function () {
            expect(reparsed.objects[0x2000].defaultValue).to.equal('0xFF');
        });

        it('should parse ARRAY with sub-objects', function () {
            const obj = reparsed.objects[0x2010];
            expect(obj).to.exist;
            expect(obj.objectType).to.equal(ObjectType.ARRAY);
            expect(obj.subObjects[1].dataType).to.equal(DataType.UNSIGNED16);
            expect(obj.subObjects[3].dataType).to.equal(DataType.UNSIGNED16);
        });

        it('should parse RECORD with mixed sub-entry types', function () {
            const obj = reparsed.objects[0x2020];
            expect(obj).to.exist;
            expect(obj.objectType).to.equal(ObjectType.RECORD);
            expect(obj.subObjects[1].parameterName).to.equal('Field A');
            expect(obj.subObjects[1].dataType).to.equal(DataType.INTEGER32);
            expect(obj.subObjects[2].dataType).to.equal(DataType.REAL32);
        });

        it('should parse comments', function () {
            expect(reparsed.comments).to.deep.equal(['Test comment']);
        });
    });

    describe('serializeEds', function () {
        it('should return a string', function () {
            expect(serializeEds(buildTestModel())).to.be.a('string');
        });

        it('should include [FileInfo] section', function () {
            expect(serializeEds(buildTestModel())).to.include('[FileInfo]');
        });

        it('should include [DeviceInfo] section', function () {
            expect(serializeEds(buildTestModel())).to.include('[DeviceInfo]');
        });

        it('should include object index in uppercase hex', function () {
            expect(serializeEds(buildTestModel())).to.include('[2000]');
        });

        it('should include sub-object sections', function () {
            expect(serializeEds(buildTestModel())).to.include('[2010sub01]');
        });

        it('should write CRLF line endings', function () {
            expect(serializeEds(buildTestModel())).to.include('\r\n');
        });
    });

    describe('round-trip', function () {
        let original;
        let reparsed;

        before(function () {
            original = buildTestModel();
            reparsed = parseEds(serializeEds(original));
        });

        it('should preserve all VAR entries', function () {
            for (const idx of [0x1000, 0x2000, 0x2001, 0x2002]) {
                expect(reparsed.objects[idx]).to.exist;
                expect(reparsed.objects[idx].parameterName)
                    .to.equal(original.objects[idx].parameterName);
                expect(reparsed.objects[idx].dataType)
                    .to.equal(original.objects[idx].dataType);
            }
        });

        it('should preserve ARRAY sub-count', function () {
            const subs = reparsed.objects[0x2010].subObjects;
            expect(Object.keys(subs).length).to.equal(4);
        });

        it('should preserve RECORD sub-count', function () {
            const subs = reparsed.objects[0x2020].subObjects;
            expect(Object.keys(subs).length).to.equal(4);
        });

        it('should preserve vendorName', function () {
            expect(reparsed.deviceInfo.vendorName).to.equal('Test Vendor');
        });

        it('should preserve baud rates', function () {
            expect(reparsed.deviceInfo.baudRate250).to.equal(true);
            expect(reparsed.deviceInfo.baudRate500).to.equal(true);
            expect(reparsed.deviceInfo.baudRate10).to.equal(false);
        });

        it('should preserve productName', function () {
            expect(reparsed.deviceInfo.productName).to.equal('Test Device');
        });

        it('should preserve ARRAY sub defaultValues', function () {
            expect(reparsed.objects[0x2010].subObjects[1].defaultValue).to.equal('100');
            expect(reparsed.objects[0x2010].subObjects[2].defaultValue).to.equal('200');
        });
    });
});
