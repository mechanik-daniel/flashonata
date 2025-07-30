Profile: ObsCodeOnly
Parent: Observation
Id: ObsCodeOnly
Title: "Observation.code Only"
Description: "A subset of an observation profile with only the code mandatory"
* code 1..1
* code.coding ^slicing.discriminator[0].type = #value
* code.coding ^slicing.discriminator[0].path = "system"
* code.coding ^slicing.discriminator[1].type = #value
* code.coding ^slicing.discriminator[1].path = "code"
* code.coding ^slicing.rules = #open
* code.coding contains SliceA 1..1
* code.coding[SliceA].system = "http://example.com/vital-signs-code" (exactly)
* code.coding[SliceA].code = #123 (exactly)
* code.coding[SliceA].display 1..1
